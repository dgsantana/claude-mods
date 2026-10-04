// The one hooks module. The engine follows `$` only into functions declared in
// this file, so every call on `$` lives here; the logic it feeds is imported.

import type { EngineInterface, Register } from 'claude-code'
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
    listMarkdown: async dir => {
      try {
        if (!(await $.fs.exists(dir))) return []
        const entries = await $.fs.list(dir)
        return entries
          .filter(e => e.kind === 'file' && /\.mdc?$/i.test(e.name))
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
  for (const w of snap.warnings) $.ui.log(`omp-port: ${w}`)
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
      for (const w of c.warnings) $.ui.log(`omp-port: ${w}`)
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

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    cached = undefined
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    cached = undefined
    return next(e)
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
    }
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, ($, e, next) => ttsr($, e, () => next(e)))
  on('tool.call', { tool: 'Write' }, ($, e, next) => ttsr($, e, () => next(e)))
}
