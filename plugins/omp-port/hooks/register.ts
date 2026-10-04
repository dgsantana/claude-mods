// The one hooks module. The engine follows `$` only into functions declared in
// this file, so every call on `$` lives here; the logic it feeds is imported.

import type { EngineInterface, Register } from 'claude-code'
import { addAgentsMd } from './agentsmd'
import { discover, homeDir, type Io, type Snapshot } from './load'
import { join } from './paths'
import { renderRulesSection } from './rules'

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
}
