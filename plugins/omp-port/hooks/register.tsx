// The one hooks module. The engine follows `$` only into functions declared in
// this file, so every call on `$` lives here; the logic it feeds is imported.

import type { EngineInterface, Register } from 'claude-code'
import { costUsd, parseVerdict, priceOrFallback, reviewPrompt } from './advisor'
import { addAgentsMd } from './agentsmd'
import { setPath, unsetPath } from './config-patch'
import { discover, homeDir, type Io, type Snapshot } from './load'
import { paneRows, parseListInput, previewSegments, projectLayerDir, rulesRows, segmentsEdit } from './pane-model'
import { isWindowsPath, join } from './paths'
import { renderRulesSection } from './rules'
import { SEGMENT_IDS, type SegmentId, SETTINGS, type Setting, TABS, type Tab, validate } from './settings-schema'
import { sanitizeStatusline, type StatuslineConfig } from './statusline-config'
import { listThemes, resolveTheme } from './themes'
import {
  astTargets,
  type Candidate,
  type CompiledRule,
  compileRule,
  extractCandidates,
  isEligible,
  markInjected,
  matchRegex,
  newRepeatState,
  onTurnEnd,
  renderReminder,
} from './ttsr-match'

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Warnings repeat on every reload of the layers; each is shown once per load of the module.
const warned = new Set<string>()

function warnOnce($: EngineInterface, text: string): void {
  if (warned.has(text)) return
  warned.add(text)
  $.ui.log(`omp-port: ${text}`)
}

function ioFrom($: EngineInterface): Io {
  return {
    env: async name => (name === 'HOME' ? $.env.get('HOME') : $.env.get('USERPROFILE')),
    read: async path => {
      try {
        if (!(await $.fs.exists(path))) return undefined
        const text = await $.fs.read(path)
        return typeof text === 'string' ? text : undefined
      } catch {
        return undefined
      }
    },
    listFiles: async (dir, ext) => {
      try {
        if (!(await $.fs.exists(dir))) return []
        const entries = await $.fs.list(dir)
        const wanted = ext === '.md' ? /\.mdc?$/i : /\.json$/i
        return entries
          .filter(e => e.kind === 'file' && wanted.test(e.name))
          .map(e => e.name)
          .sort()
      } catch {
        return []
      }
    },
  }
}

async function loadAll($: EngineInterface): Promise<Snapshot> {
  const repo = await $.session.repo().catch(() => null)
  const cwd = await $.session.cwd()
  const root = repo?.root ?? (await $.session.root())
  const snap = await discover(ioFrom($), { builtinDir: join($.plugin.root, 'builtin-rules'), root, cwd })
  for (const w of snap.warnings) warnOnce($, w)
  return snap
}

// The loaded layers, cached until the next turn starts, so rule edits made
// between turns are picked up without re-reading on every model request.
let cached: Promise<Snapshot> | undefined

function snapshot($: EngineInterface): Promise<Snapshot> {
  if (!cached) {
    const loading = loadAll($)
    loading.catch(() => {
      if (cached === loading) cached = undefined
    })
    cached = loading
  }
  return cached
}

// TTSR: rules compiled once per snapshot.
let compiledFor: Snapshot | undefined
let compiled: CompiledRule[] = []

function compiledRules($: EngineInterface, snap: Snapshot): CompiledRule[] {
  if (compiledFor !== snap) {
    compiledFor = snap
    compiled = []
    for (const rule of snap.rules) {
      const c = compileRule(rule)
      if (!c) continue
      for (const w of c.warnings) warnOnce($, w)
      compiled.push(c)
    }
  }
  return compiled
}

const REPEAT = { plugin: 'omp-port', key: 'ttsrRepeat' } as const
const AST_HINTED = { plugin: 'omp-port', key: 'astGrepHinted' } as const

function astGrepInstallHint(windows: boolean): string {
  return windows
    ? 'omp-port: ast-grep not found, AST rules skipped. Install: `scoop install ast-grep` or `mise use -g ast-grep`'
    : 'omp-port: ast-grep not found, AST rules skipped. Install: `mise use -g ast-grep` or `cargo install ast-grep`'
}

// Runs ast-grep over the candidate text; 'missing' when the binary is absent.
async function astGrepMatches($: EngineInterface, pattern: string, lang: string, text: string): Promise<boolean | 'missing'> {
  try {
    const r = await $.process.run(['ast-grep', 'run', '--pattern', pattern, '--lang', lang, '--stdin', '--json=compact'], {
      stdin: text,
      timeoutMs: 5000,
    })
    if (r.exitCode === 127) return 'missing'
    const parsed: unknown = JSON.parse(r.stdout.trim() || '[]')
    return Array.isArray(parsed) && parsed.length > 0
  } catch (err) {
    return /ENOENT|not found|no such file/i.test(errText(err)) ? 'missing' : false
  }
}

async function ttsrMatches($: EngineInterface, rules: CompiledRule[], cand: Candidate): Promise<CompiledRule[]> {
  const hits = new Set(matchRegex(rules, cand))
  for (const t of astTargets(rules, cand)) {
    if (hits.has(t.rule)) continue
    for (const pattern of t.patterns) {
      const m = await astGrepMatches($, pattern, t.lang, cand.text)
      if (m === 'missing') {
        const hinted = await $.state.get(AST_HINTED)
        if (!hinted.value) {
          await $.state.set(AST_HINTED, true)
          $.ui.toast(astGrepInstallHint(isWindowsPath($.plugin.root)))
        }
        return [...hits]
      }
      if (m) {
        hits.add(t.rule)
        break
      }
    }
  }
  return [...hits]
}

type ToolAnswer = Awaited<ReturnType<EngineInterface['tool']['call']>>

async function ttsr($: EngineInterface, e: { tool: string }, run: () => Promise<ToolAnswer>): Promise<ToolAnswer> {
  let snap: Snapshot
  try {
    snap = await snapshot($)
  } catch {
    return run()
  }
  const cfg = snap.config.ttsr
  const rules = cfg.enabled ? compiledRules($, snap) : []
  const cands = extractCandidates(e.tool, e)
  if (rules.length === 0 || cands.length === 0) return run()

  const held = await $.state.get(REPEAT)
  const state = held.value ?? newRepeatState()
  const deny: string[] = []
  const remind: string[] = []
  const fired: string[] = []
  for (const cand of cands) {
    for (const c of await ttsrMatches($, rules, cand)) {
      const name = c.rule.name
      if (fired.includes(name) || !isEligible(state, name, cfg.repeatMode, cfg.repeatGap)) continue
      const mode = c.rule.interruptMode ?? cfg.interruptMode
      if (mode === 'prose-only') continue
      fired.push(name)
      markInjected(state, name)
      ;(mode === 'never' ? remind : deny).push(renderReminder(c.rule, cand.path))
    }
  }
  if (fired.length === 0) return run()
  await $.state.set(REPEAT, state)
  $.ui.toast(`omp-port TTSR: ${fired.join(', ')}`)
  if (deny.length > 0) return { deny: [...deny, ...remind].join('\n\n') }
  const result = await run()
  if (result.deny !== undefined) return result
  return { ...result, context: [...(result.context ?? []), remind.join('\n\n')] }
}

// Advisor: reviews turns that edited files; the person accepts or ignores
// its note before the next prompt. Settings live in $.store over config.
const EDITS = { plugin: 'omp-port', key: 'advisorEdits' } as const
const NOTE = { plugin: 'omp-port', key: 'advisorNote' } as const
const DECISION = { plugin: 'omp-port', key: 'advisorDecision' } as const
const SESSION_USD = { plugin: 'omp-port', key: 'advisorSessionUsd' } as const
const LAST_ERROR = { plugin: 'omp-port', key: 'advisorLastError' } as const
const ESTIMATED_FOR = { plugin: 'omp-port', key: 'advisorEstimatedFor' } as const

type AdvisorSettings = { enabled: boolean; model?: string; budgetUsd?: number; totalUsd: number }

async function advisorSettings($: EngineInterface): Promise<AdvisorSettings> {
  let cfg = { enabled: false } as { enabled: boolean; model?: string; budgetUsd?: number }
  try {
    cfg = (await snapshot($)).config.advisor
  } catch {}
  const enabled = await $.store.get('advisor.enabled')
  const model = await $.store.get('advisor.model')
  const budget = await $.store.get('advisor.budgetUsd')
  const total = await $.store.get('advisor.totalUsd')
  return {
    enabled: typeof enabled === 'boolean' ? enabled : cfg.enabled,
    model: typeof model === 'string' && model !== '' ? model : cfg.model,
    budgetUsd: typeof budget === 'number' ? budget : cfg.budgetUsd,
    totalUsd: typeof total === 'number' ? total : 0,
  }
}

async function trackEdit($: EngineInterface, e: { file_path?: unknown; agentId?: string }, r: ToolAnswer): Promise<void> {
  if (e.agentId !== undefined || r.deny !== undefined || r.isError === true || typeof e.file_path !== 'string') return
  const held = await $.state.get(EDITS)
  const edits = held.value ?? []
  if (!edits.includes(e.file_path)) await $.state.set(EDITS, [...edits, e.file_path])
}

async function advisorReview($: EngineInterface, files: string[], answer: string): Promise<void> {
  const s = await advisorSettings($)
  if (!s.enabled || (s.budgetUsd !== undefined && s.totalUsd >= s.budgetUsd)) return
  const r = s.model
    ? await $.model.complete({ model: s.model, prompt: reviewPrompt(files, answer) })
    : await $.model.fork({ prompt: reviewPrompt(files) })

  if ('usage' in r) {
    let prices = {}
    try {
      prices = (await snapshot($)).config.advisor.prices
    } catch {}
    const model = s.model ?? (await $.session.model())
    const { price, estimated } = priceOrFallback(model, prices)
    const cost = costUsd(r.usage, price)
    if (estimated && (await $.state.get(ESTIMATED_FOR)).value !== model) {
      await $.state.set(ESTIMATED_FOR, model)
      $.ui.toast(`Advisor: no price for ${model}; spend estimated at the highest known rate (set advisor.prices in config)`)
    }
    const total = s.totalUsd + cost
    await $.store.set('advisor.totalUsd', total)
    const session = await $.state.get(SESSION_USD)
    await $.state.set(SESSION_USD, (session.value ?? 0) + cost)
    if (s.budgetUsd !== undefined && total >= s.budgetUsd) {
      await $.store.set('advisor.enabled', false)
      $.ui.toast(`Advisor off: budget $${s.budgetUsd.toFixed(2)} reached ($${total.toFixed(3)} spent)`)
    }
  }

  if (!r.isAnswered) {
    await $.state.set(LAST_ERROR, r.reason)
    $.ui.log(`omp-port: advisor got no review (${r.reason})`)
    return
  }
  await $.state.set(LAST_ERROR, null)
  const verdict = parseVerdict(r.text)
  if (verdict.ok) return
  await $.state.set(NOTE, verdict.note)
  await $.state.set(DECISION, 'accept')
  $.ui.toast(`Advisor: ${verdict.note}`)
}

async function advisorCommand($: EngineInterface, args: string): Promise<string> {
  const [verb = 'status', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const value = rest.join(' ')
  switch (verb) {
    case 'on':
      await $.store.set('advisor.enabled', true)
      return 'Advisor on.'
    case 'off':
      await $.store.set('advisor.enabled', false)
      return 'Advisor off.'
    case 'model':
      if (value === '' || value === 'default') await $.store.delete('advisor.model')
      else await $.store.set('advisor.model', value)
      return value === '' || value === 'default' ? 'Advisor model: session model (fork).' : `Advisor model: ${value}.`
    case 'budget': {
      const usd = Number(value)
      if (value === '' || value === 'none') {
        await $.store.delete('advisor.budgetUsd')
        return 'Advisor budget removed.'
      }
      if (!Number.isFinite(usd) || usd < 0) return `Not a budget: ${value}`
      await $.store.set('advisor.budgetUsd', usd)
      return `Advisor budget: $${usd.toFixed(2)}.`
    }
    case 'reset':
      await $.store.set('advisor.totalUsd', 0)
      return 'Advisor spend reset.'
    case 'status': {
      const s = await advisorSettings($)
      const session = (await $.state.get(SESSION_USD)).value ?? 0
      const lastError = (await $.state.get(LAST_ERROR)).value
      const estimatedFor = (await $.state.get(ESTIMATED_FOR)).value
      const reached = s.budgetUsd !== undefined && s.totalUsd >= s.budgetUsd
      return [
        `Advisor ${s.enabled ? 'on' : 'off'}${s.enabled && reached ? ' (budget reached; raise it or /advisor reset)' : ''}`,
        `model: ${s.model ?? 'session model (fork)'}`,
        `budget: ${s.budgetUsd !== undefined ? `$${s.budgetUsd.toFixed(2)}` : 'none'}${reached ? ' — budget reached' : ''}`,
        `spent: session $${session.toFixed(3)}, total $${s.totalUsd.toFixed(3)}${estimatedFor ? ` (estimated for ${estimatedFor})` : ''}`,
        ...(lastError ? [`last review failed: ${lastError}`] : []),
      ].join(' · ')
    }
    default:
      return 'Usage: /advisor on|off|status|model <id|default>|budget <usd|none>|reset'
  }
}

// The /omp settings pane: tabs over the settings catalogue, writing the
// global or the project layer's config.json (store-backed rows to $.store).
const PANE_ID = 'omp-port-settings'
const PANE_TAB = { plugin: 'omp-port', key: 'paneTab' } as const
const PANE_SCOPE = { plugin: 'omp-port', key: 'paneScope' } as const
const PANE_ERROR = { plugin: 'omp-port', key: 'paneError' } as const

let themeTable: Record<string, Record<string, string>> | undefined

async function builtinThemes($: EngineInterface): Promise<Record<string, Record<string, string>>> {
  if (themeTable) return themeTable
  try {
    const text = await ioFrom($).read(join($.plugin.root, 'themes', 'builtin.json'))
    themeTable = text ? (JSON.parse(text) as Record<string, Record<string, string>>) : {}
  } catch {
    themeTable = {}
  }
  return themeTable
}

type PaneTargets = { global?: string; project?: string }

async function paneTargets($: EngineInterface, snap: Snapshot): Promise<PaneTargets> {
  const home = await homeDir(ioFrom($))
  const repo = await $.session.repo().catch(() => null)
  const projectDir = projectLayerDir(snap.layers, repo !== null)
  return {
    global: home ? join(home, '.agents', 'mods', 'config.json') : undefined,
    project: projectDir ? join(projectDir, 'mods', 'config.json') : undefined,
  }
}

async function storeValues($: EngineInterface): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const s of SETTINGS) if (s.storage === 'store') out[s.key] = await $.store.get(s.key)
  return out
}

// Applies one change to the chosen layer: `patch` turns the file's text into
// the new text, or says why it can't.
async function patchLayer(
  $: EngineInterface,
  setting: Setting,
  patch: (text: string | undefined) => { text: string } | { error: string },
): Promise<void> {
  const snap = await snapshot($)
  const scope = (await $.state.get(PANE_SCOPE)).value ?? 'global'
  const targets = await paneTargets($, snap)
  const target = scope === 'project' ? targets.project : targets.global
  if (!target) {
    $.ui.toast(`omp-port: no ${scope} config location here`)
    return
  }
  const fail = async (why: string) => {
    $.ui.toast(`omp-port: ${target}: ${why}; left unchanged`)
    await $.state.set(PANE_ERROR, { key: setting.key, text: why })
  }
  // A file that exists but can't be read is never treated as missing.
  let text: string | undefined
  try {
    if (await $.fs.exists(target)) {
      const read = await $.fs.read(target)
      if (typeof read !== 'string') return fail('not a text file')
      text = read
    }
  } catch (err) {
    return fail(`can't read it (${errText(err)})`)
  }
  const r = patch(text)
  if ('error' in r) return fail(r.error)
  try {
    await $.fs.write(target, r.text)
  } catch (err) {
    return fail(errText(err))
  }
  await $.state.set(PANE_ERROR, null)
  cached = undefined
}

async function writeSetting($: EngineInterface, setting: Setting, raw: unknown): Promise<void> {
  if (setting.storage === 'store' && (raw === '' || raw === undefined)) {
    await $.store.delete(setting.key)
    await $.state.set(PANE_ERROR, null)
    return
  }
  const v = validate(setting, raw)
  if ('error' in v) {
    await $.state.set(PANE_ERROR, { key: setting.key, text: v.error })
    return
  }
  if (setting.storage === 'store') {
    await $.store.set(setting.key, v.value)
    await $.state.set(PANE_ERROR, null)
    return
  }
  await patchLayer($, setting, text => setPath(text, setting.key, v.value))
}

async function resetSetting($: EngineInterface, setting: Setting): Promise<void> {
  if (setting.storage === 'store') {
    await $.store.delete(setting.key)
    return
  }
  await patchLayer($, setting, text => unsetPath(text, setting.key))
}

async function setScope($: EngineInterface, scope: 'global' | 'project'): Promise<void> {
  if (scope === 'project') {
    const targets = await paneTargets($, await snapshot($))
    if (!targets.project) {
      $.ui.toast('omp-port: "This project" needs a git repository; writing to the global layer')
      return
    }
  }
  await $.state.set(PANE_SCOPE, scope)
}

// The tab-specific block above the settings rows: the status line preview,
// the rule list, the advisor's spend.
async function paneExtras(
  $: EngineInterface,
  tab: Tab,
  snap: Snapshot,
  statusline: StatuslineConfig,
  builtin: Record<string, Record<string, string>>,
  e: Parameters<EngineInterface['ui']['resolve']>[0],
) {
  const { Box, Button, Text } = $.ui.resolve(e)
  if (tab === 'statusline') {
    const resolved = resolveTheme(statusline.theme, builtin, snap.themeSpecs)
    const warnings = [...sanitizeStatusline(snap.config.statusline).warnings, ...resolved.warnings]
    for (const w of warnings) warnOnce($, w)
    return (
      <Box flexDirection="column">
        <Box gap={1} flexWrap="wrap">
          <Text dimColor>preview</Text>
          {previewSegments(statusline, resolved.theme).map(seg => (
            <Text color={seg.colour}>{seg.text}</Text>
          ))}
        </Box>
        {warnings.map(w => (
          <Text color="yellow">{`⚠ ${w}`}</Text>
        ))}
      </Box>
    )
  }
  if (tab === 'rules') {
    const disabledSetting = SETTINGS.find(s => s.key === 'rules.disabled') as Setting
    const disabled = snap.config.rules.disabled
    return (
      <Box flexDirection="column">
        {rulesRows(snap.allRules, snap.config.rules).map(r => (
          <Box key={`rulerow-${r.name}`} gap={1}>
            <Button
              key={`rule-${r.name}`}
              label={r.disabled ? '[ ]' : '[x]'}
              plain
              onPress={() =>
                writeSetting($, disabledSetting, disabled.includes(r.name) ? disabled.filter(n => n !== r.name) : [...disabled, r.name])
              }
            />
            <Text dimColor={r.disabled}>{`${r.name}  ${r.kind} · ${r.source}`}</Text>
          </Box>
        ))}
      </Box>
    )
  }
  if (tab === 'advisor') {
    const session = (await $.state.get(SESSION_USD)).value ?? 0
    const total = await $.store.get('advisor.totalUsd')
    const lastError = (await $.state.get(LAST_ERROR)).value
    return (
      <Box gap={1}>
        <Text>{`spent: session $${session.toFixed(3)}, total $${(typeof total === 'number' ? total : 0).toFixed(3)}`}</Text>
        <Button key="advisor-reset-spend" label="Reset spend" onPress={() => $.store.set('advisor.totalUsd', 0)} />
        {lastError ? <Text color="red">{`last review failed: ${lastError}`}</Text> : null}
      </Box>
    )
  }
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cached = undefined
    await $.command.register({
      name: 'advisor',
      description: 'Advisor review of edit turns: on, off, status, model, budget',
      argumentHint: 'on|off|status|model <id>|budget <usd>',
    })
    await $.command.register({
      name: 'omp',
      description: 'omp-port settings: status line, TTSR, rules, advisor, context',
      argumentHint: '[statusline|ttsr|rules|advisor|context]',
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    cached = undefined
    await $.state.set(EDITS, [])
    return next(e)
  })

  on('command.run', { command: 'omp' }, async ($, e) => {
    const tab = TABS.find(t => t.id === e.args.trim())?.id
    if (tab) await $.state.set(PANE_TAB, tab)
    await $.ui.open({ id: PANE_ID, title: 'omp-port settings', focus: true, closeOnEscape: true })
    return { text: 'omp-port settings opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text>omp-port settings need a terminal or desktop session (pickers and inputs).</Text>
    }
    const { Box, Button, Input, Select, Text } = $.ui.resolve(e)
    const tab: Tab = (await $.state.get(PANE_TAB)).value ?? 'statusline'
    const scope = (await $.state.get(PANE_SCOPE)).value ?? 'global'
    const error = (await $.state.get(PANE_ERROR)).value
    let snap: Snapshot
    try {
      snap = await snapshot($)
    } catch (err) {
      return <Text>omp-port: settings unavailable ({errText(err)})</Text>
    }
    const targets = await paneTargets($, snap)
    const rows = paneRows(tab, snap, await storeValues($))
    const builtin = await builtinThemes($)
    const themes = listThemes(builtin, snap.themeSpecs)
    const statusline = sanitizeStatusline(snap.config.statusline).config
    const extra = await paneExtras($, tab, snap, statusline, builtin, e)

    const control = (s: Setting, value: unknown) => {
      const key = `set-${s.key}`
      switch (s.kind) {
        case 'bool':
          return <Button key={key} label={value ? '[x] on' : '[ ] off'} onPress={() => writeSetting($, s, !value)} />
        case 'enum':
        case 'theme': {
          const options = s.kind === 'enum' ? s.options : themes.includes(String(value)) ? themes : [String(value), ...themes]
          return (
            <Select key={key} options={options.map(o => ({ value: o }))} value={String(value)} onSelect={(v: string) => writeSetting($, s, v)} />
          )
        }
        case 'segments': {
          const list = (Array.isArray(value) ? value : []) as SegmentId[]
          const used = new Set([...statusline.left, ...statusline.right])
          const free = SEGMENT_IDS.filter(id => !used.has(id))
          const edit = (op: Parameters<typeof segmentsEdit>[1]) => writeSetting($, s, segmentsEdit(list, op))
          return (
            <Box key={key} gap={1} flexWrap="wrap">
              {list.map(id => (
                <Box key={`seg-${s.key}-${id}`}>
                  <Text>{id}</Text>
                  <Button key={`seg-${s.key}-${id}-up`} label="↑" plain onPress={() => edit({ up: id })} />
                  <Button key={`seg-${s.key}-${id}-down`} label="↓" plain onPress={() => edit({ down: id })} />
                  <Button key={`seg-${s.key}-${id}-remove`} label="✕" plain onPress={() => edit({ remove: id })} />
                </Box>
              ))}
              {free.length > 0 ? (
                <Select
                  key={`seg-${s.key}-add`}
                  label="+ add"
                  options={free.map(id => ({ value: id }))}
                  onSelect={(v: string) => edit({ add: v as SegmentId })}
                />
              ) : null}
            </Box>
          )
        }
        case 'stringList':
          return (
            <Input
              key={key}
              value={Array.isArray(value) ? value.join(', ') : ''}
              onSubmit={(v: string) => writeSetting($, s, parseListInput(v))}
            />
          )
        default:
          return <Input key={key} value={value === undefined ? '' : String(value)} onSubmit={(v: string) => writeSetting($, s, v)} />
      }
    }

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          {TABS.map((t, i) => (
            <Button
              key={`tab-${t.id}`}
              hotkey={String(i + 1)}
              label={t.label}
              variant={t.id === tab ? 'primary' : undefined}
              onPress={() => $.state.set(PANE_TAB, t.id)}
            />
          ))}
        </Box>
        <Box gap={1}>
          <Text dimColor>write to</Text>
          <Button key="scope-global" label="Global" variant={scope === 'global' ? 'primary' : undefined} onPress={() => setScope($, 'global')} />
          <Button
            key="scope-project"
            label="This project"
            dimColor={!targets.project}
            variant={scope === 'project' ? 'primary' : undefined}
            onPress={() => setScope($, 'project')}
          />
          <Text dimColor>{(scope === 'project' ? targets.project : targets.global) ?? ''}</Text>
        </Box>
        {extra}
        {rows.map(row => (
          <Box key={`row-${row.setting.key}`} flexDirection="column">
            <Box gap={1}>
              <Text bold>{row.setting.label}</Text>
              {control(row.setting, row.value)}
              <Text dimColor>({row.origin})</Text>
              <Button key={`reset-${row.setting.key}`} label="reset" plain onPress={() => resetSetting($, row.setting)} />
            </Box>
            {error?.key === row.setting.key ? <Text color="red">{error.text}</Text> : <Text dimColor>{row.setting.description}</Text>}
          </Box>
        ))}
      </Box>
    )
  })

  on('command.run', { command: 'advisor' }, async ($, e) => ({ text: await advisorCommand($, e.args) }))

  on('prompt.submit', async ($, e, next) => {
    const note = (await $.state.get(NOTE)).value
    if (!note) return next(e)
    const decision = (await $.state.get(DECISION)).value ?? 'accept'
    await $.state.set(NOTE, null)
    if (decision === 'ignore') return next(e)
    const block = `<advisor-note>\nA reviewer looked at your last edits and flagged:\n${note}\n</advisor-note>`
    return next({ ...e, context: [...(e.context ?? []), block] })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const note = (await $.state.get(NOTE)).value
    if (!note) return next(e)
    const decision = (await $.state.get(DECISION)).value ?? 'accept'
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold color="warning">Advisor: </Text>
          {note}
        </Text>
        <Box>
          <Button
            key="advisor-accept"
            label={decision === 'accept' ? '✓ Send with next prompt' : 'Send with next prompt'}
            onPress={() => $.state.set(DECISION, 'accept')}
          />
          <Text> </Text>
          <Button
            key="advisor-ignore"
            label={decision === 'ignore' ? '✓ Ignore' : 'Ignore'}
            onPress={() => $.state.set(DECISION, 'ignore')}
          />
        </Box>
      </Box>
    )
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    try {
      const snap = await snapshot($)
      const added = []
      if (snap.config.append.enabled && snap.append !== '') {
        added.push({ id: 'omp-port:append', text: snap.append, scope: 'session' as const })
      }
      const rules = renderRulesSection(snap.rules)
      if (rules !== undefined) added.push({ id: 'omp-port:rules', text: rules, scope: 'session' as const })
      return added.length > 0 ? { ...composed, sections: [...composed.sections, ...added] } : composed
    } catch (err) {
      $.ui.log(`omp-port: prompt.compose skipped (${errText(err)})`)
      return composed
    }
  })

  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    if (result.instructionFiles === undefined) return result
    try {
      const snap = await snapshot($)
      if (!snap.config.agentsMd.enabled) return result
      const found = await $.fs.ancestors({ names: ['AGENTS.md'] })
      const io = ioFrom($)
      const home = await homeDir(io)
      const globalPath = home ? join(home, '.agents', 'AGENTS.md') : undefined
      const globalText = globalPath ? await io.read(globalPath) : undefined
      const global = globalPath && globalText !== undefined ? { path: globalPath, content: globalText } : undefined
      return addAgentsMd(result, found, global)
    } catch (err) {
      $.ui.log(`omp-port: AGENTS.md skipped (${errText(err)})`)
      return result
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const held = await $.state.get(REPEAT)
      const state = held.value ?? newRepeatState()
      onTurnEnd(state)
      await $.state.set(REPEAT, state)
      const edits = (await $.state.get(EDITS)).value ?? []
      if (!e.isAborted && edits.length > 0) {
        await $.state.set(EDITS, [])
        const answer = e.answer
        // Outside this dispatch, so the review never holds up the turn.
        $.clock.after(0, () => {
          advisorReview($, edits, answer).catch(err => $.ui.log(`omp-port: advisor failed (${errText(err)})`))
        })
      }
    }
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r = await ttsr($, e, () => next(e))
    await trackEdit($, e, r)
    return r
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const r = await ttsr($, e, () => next(e))
    await trackEdit($, e, r)
    return r
  })
}
