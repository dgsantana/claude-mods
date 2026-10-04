import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'
import { world } from './world'

type Fork = { reply?: string; answered?: boolean; nothing?: boolean; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } }

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 0 }

// The engine beneath the plugin, with the advisor switched on through the store.
function engine(on: On, opts: { store?: Record<string, unknown>; fork?: Fork } = {}) {
  const captured = world(on, {})
  mock.store(on, opts.store ?? { 'advisor.enabled': true })
  const clock = mock.clock(on)
  const forks: string[] = []
  on('model.fork', ($, e) => {
    forks.push(e.prompt)
    const f = opts.fork ?? {}
    if (f.nothing) return { value: { isAnswered: false, reason: 'nothing-to-fork' } as never }
    if (f.answered === false) return { value: { isAnswered: false, reason: 'api-error', status: 500, error: 'api_error', usage: USAGE } as never }
    return { value: { isAnswered: true, text: f.reply ?? 'OK', usage: f.usage ?? USAGE } }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('tool.call', () => ({ result: { ok: true } as never }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  return { ...captured, clock, forks }
}

async function editTurn($: Engine, clock: { settle: () => Promise<void> }, agentId?: string) {
  await $.turn.start({ text: 'do it', turnId: 't' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b', ...(agentId ? { agentId } : {}) } as never)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await clock.settle()
}

test('disabled by default: no fork', async ($, on) => {
  const w = engine(on, { store: {} })
  await editTurn($, w.clock)
  expect(w.forks).toEqual([])
})

test('turn without edits: no fork', async ($, on) => {
  const w = engine(on)
  await $.turn.start({ text: 'q', turnId: 't' } as never)
  await $.turn.complete({ answer: 'answer', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await w.clock.settle()
  expect(w.forks).toEqual([])
})

test('edit turn with OK verdict: one fork naming the file, nothing shown', async ($, on) => {
  const w = engine(on)
  await editTurn($, w.clock)
  expect(w.forks).toHaveLength(1)
  expect(w.forks[0]).toContain('/repo/a.ts')
  expect(w.toasts.filter(t => t.includes('Advisor'))).toEqual([])
})

test('subagent edits do not mark the turn', async ($, on) => {
  const w = engine(on)
  await editTurn($, w.clock, 'sub-1')
  expect(w.forks).toEqual([])
})

test('note: toast, band with Accept/Ignore, accepted note rides the next prompt', async ($, on) => {
  const w = engine(on, { fork: { reply: 'foo() lost its null check.' } })
  await editTurn($, w.clock)
  expect(w.toasts.some(t => t.includes('foo() lost its null check.'))).toBe(true)

  const band = await $.ui.mount({ plugin: 'omp-port', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5 } as never })
  expect(await band.find({ text: /null check/ })).toBeDefined()
  expect(await band.find({ key: 'advisor-accept' })).toBeDefined()

  const r = (await $.prompt.submit({ text: 'next', wait: false } as never)) as { context?: string[] }
  expect(r.context?.join('\n')).toContain('foo() lost its null check.')

  const r2 = (await $.prompt.submit({ text: 'again', wait: false } as never)) as { context?: string[] }
  expect((r2.context ?? []).join('\n')).not.toContain('null check')
})

test('ignore: the note is dropped from the next prompt', async ($, on) => {
  const w = engine(on, { fork: { reply: 'Bad change.' } })
  await editTurn($, w.clock)
  const band = await $.ui.mount({ plugin: 'omp-port', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5 } as never })
  await band.press({ key: 'advisor-ignore' })
  const r = (await $.prompt.submit({ text: 'next', wait: false } as never)) as { context?: string[] }
  expect((r.context ?? []).join('\n')).not.toContain('Bad change.')
})

test('spend accumulates; crossing the budget switches the advisor off', async ($, on) => {
  // One review: 1000*4 + 200*20 + 50000*0.2 = 18000 µ$ = $0.018
  const w = engine(on, { store: { 'advisor.enabled': true, 'advisor.budgetUsd': 0.03, 'advisor.totalUsd': 0.015 } })
  await editTurn($, w.clock)
  expect(w.forks).toHaveLength(1)
  expect(w.toasts.some(t => /budget/i.test(t))).toBe(true)
  await editTurn($, w.clock)
  expect(w.forks).toHaveLength(1)
  const status = await $.command.run({ command: 'advisor', args: 'status' } as never)
  expect(status.text).toMatch(/off/i)
  expect(status.text).toContain('$0.033')
})

test('budget already spent at start: no fork', async ($, on) => {
  const w = engine(on, { store: { 'advisor.enabled': true, 'advisor.budgetUsd': 0.01, 'advisor.totalUsd': 0.02 } })
  await editTurn($, w.clock)
  expect(w.forks).toEqual([])
})

test('fork not answered: nothing shown, one log line', async ($, on) => {
  const w = engine(on, { fork: { answered: false } })
  await editTurn($, w.clock)
  expect(w.toasts.filter(t => t.includes('Advisor'))).toEqual([])
  expect(w.logs.some(l => l.includes('advisor'))).toBe(true)
})

test('/advisor on|off|budget|model|status', async ($, on) => {
  engine(on, { store: {} })
  expect((await $.command.run({ command: 'advisor', args: 'on' } as never)).text).toMatch(/on/i)
  await $.command.run({ command: 'advisor', args: 'budget 2.5' } as never)
  await $.command.run({ command: 'advisor', args: 'model claude-haiku-4-5' } as never)
  const status = (await $.command.run({ command: 'advisor', args: 'status' } as never)).text ?? ''
  expect(status).toMatch(/on/i)
  expect(status).toContain('claude-haiku-4-5')
  expect(status).toContain('$2.50')
  expect((await $.command.run({ command: 'advisor', args: 'off' } as never)).text).toMatch(/off/i)
})

test('configured model uses model.complete with the answer, not fork', async ($, on) => {
  const w = engine(on, { store: { 'advisor.enabled': true, 'advisor.model': 'claude-haiku-4-5' } })
  const completes: string[] = []
  on('model.complete', ($, e) => {
    completes.push(`${e.model}|${e.prompt}`)
    return { value: { isAnswered: true, text: 'OK', usage: USAGE } }
  })
  await editTurn($, w.clock)
  expect(w.forks).toEqual([])
  expect(completes).toHaveLength(1)
  expect(completes[0]).toContain('claude-haiku-4-5|')
  expect(completes[0]).toContain('done')
})

test('nothing to fork: no spend, no note, one log line, no crash', async ($, on) => {
  const w = engine(on, { fork: { nothing: true } })
  await editTurn($, w.clock)
  expect(w.logs.some(l => l.includes('nothing-to-fork'))).toBe(true)
  expect(w.logs.some(l => l.includes('advisor failed'))).toBe(false)
  const status = (await $.command.run({ command: 'advisor', args: 'status' } as never)).text ?? ''
  expect(status).toContain('total $0.000')
})
