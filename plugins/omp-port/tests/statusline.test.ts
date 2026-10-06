import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'
import { world } from './world'

type Opts = { config?: string; gitFails?: boolean; store?: Record<string, unknown> }

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const PORCELAIN = '# branch.oid abc\n# branch.head main\n# branch.ab +1 -0\n1 .M N... 100644 100644 100644 a b x.ts\n'

// The engine beneath the plugin: a session on Opus in /repo, 58% of a 1M
// window used, a dirty `main`, caveman in ultra mode.
function engine(on: On, opts: Opts = {}) {
  const files: Record<string, string> = { '/home/u/.claude/.caveman-active': 'ultra' }
  if (opts.config) files['/home/u/.agents/mods/config.json'] = opts.config
  const captured = world(on, { files, themes: { dark: { statusLineModel: '#111111' } } })
  mock.store(on, opts.store ?? {})
  const clock = mock.clock(on)
  const runs: string[][] = []
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 580_000, window: 1_000_000, percent: 58 }, rateLimits: [], cost: { usd: 1.25 } } as never,
  }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    if (opts.gitFails) return { deny: 'git: not found' }
    return { value: { exitCode: 0, stdout: PORCELAIN, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // What the engine draws when the plugin passes: an empty box.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}) as never)
  return { ...captured, clock, runs }
}

async function start($: Engine, clock: { settle: () => Promise<void> }) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
}

const band = ($: Engine) =>
  $.ui.mount({
    plugin: 'omp-port',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 120 } as never,
  })

test('after session start the band shows model, caveman, branch, cost and the context gauge', async ($, on) => {
  const w = engine(on)
  await start($, w.clock)
  const b = await band($)
  expect(await b.find({ text: /Opus 5\.5 1M/ })).toBeDefined()
  expect(await b.find({ text: /ULTRA/ })).toBeDefined()
  expect(await b.find({ text: /main\*/ })).toBeDefined()
  expect(await b.find({ text: /\$1\.25/ })).toBeDefined()
  expect(await b.find({ text: /58%/ })).toBeDefined()
  expect(w.runs[0]?.slice(0, 2)).toEqual(['git', 'status'])
})

test('statusline.enabled false draws nothing', async ($, on) => {
  const w = engine(on, { config: '{"statusline":{"enabled":false}}' })
  await start($, w.clock)
  const b = await band($)
  expect(await b.find({ text: /Opus/ })).toBeUndefined()
})

test('a failing git still draws the rest', async ($, on) => {
  const w = engine(on, { gitFails: true })
  await start($, w.clock)
  const b = await band($)
  expect(await b.find({ text: /Opus 5\.5/ })).toBeDefined()
  expect(await b.find({ text: /main/ })).toBeUndefined()
})

test('the advisor note shows under the status row with its buttons', async ($, on) => {
  const w = engine(on, { store: { 'advisor.enabled': true } })
  on('model.fork', () => ({ value: { isAnswered: true, text: 'foo() lost its null check.', usage: USAGE } }))
  on('tool.call', () => ({ result: { ok: true } as never }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await start($, w.clock)
  await $.turn.start({ text: 'do it', turnId: 't' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await w.clock.settle()
  const b = await band($)
  expect(await b.find({ text: /Opus 5\.5/ })).toBeDefined()
  expect(await b.find({ text: /null check/ })).toBeDefined()
  expect(await b.find({ key: 'advisor-accept' })).toBeDefined()
})
