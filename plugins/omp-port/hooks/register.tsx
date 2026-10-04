// The one hooks module. The engine follows `$` only into functions declared in
// this file, so every call on `$` lives here; the logic it feeds is imported.

import type { EngineInterface, Register } from 'claude-code'
import { costUsd, parseVerdict, priceOrFallback, reviewPrompt } from './advisor'
import { addAgentsMd } from './agentsmd'
import { discover, homeDir, type Io, type Snapshot } from './load'
import { isWindowsPath, join } from './paths'
import { renderRulesSection } from './rules'
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cached = undefined
    await $.command.register({
      name: 'advisor',
      description: 'Advisor review of edit turns: on, off, status, model, budget',
      argumentHint: 'on|off|status|model <id>|budget <usd>',
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    cached = undefined
    await $.state.set(EDITS, [])
    return next(e)
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
