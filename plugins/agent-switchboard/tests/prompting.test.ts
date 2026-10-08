import type { On } from 'claude-code'
import { type Engine, expect, type MockClock, mock, test } from 'claude-code/testing'

// One session beneath the mod, a settings file saying whether prompting is on, and a hub that hands out
// one queued prompt, written by `from` (null: a hub from before prompts said who wrote them), and
// records every request for one.
function world(on: On, allowPrompting: boolean, written = 'continue with the tests', from: string | null = 'person') {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/u' })
  const asked: string[] = []
  const submitted: Array<Record<string, unknown>> = []
  const ran: Array<{ command: string; args: string }> = []
  let queued: string | undefined = written
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } } as never }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', () => ({ value: JSON.stringify({ board: { allowPrompting } }) }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: e.name } }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
    submitted.push({ ...e })
    return { text: e.text } as never
  })
  on('command.list', () => ({ value: [
      { name: 'reload-plugins', description: 'Reload plugins', source: 'builtin' },
      { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
    ] }) as never)
  on('command.run', ($, e) => {
    ran.push({ command: e.command, args: e.args })
    return { text: 'Reloaded.' }
  })
  on('http.fetch', ($, e) => {
    if (e.url.endsWith('/api/token')) return { value: { status: 200, ok: true, headers: {}, text: '{"token":"tok"}' } }
    asked.push(e.url)
    if (e.init?.headers?.['x-hub-token'] !== 'tok') return { value: { status: 403, ok: false, headers: {}, text: '' } }
    const next = queued
    queued = undefined
    return next === undefined
      ? { value: { status: 403, ok: false, headers: {}, text: '' } }
      : { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ promptId: 'p1', text: next, ...(from === null ? {} : { from }) }) } }
  })
  return { clock, asked, submitted, ran }
}

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as never
const DONE = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

async function idleAfterATurn($: Engine, clock: MockClock) {
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  await $.turn.complete(DONE)
  await clock.settle()
}

test('once a turn ends, a prompt written on the board is taken and submitted as the person\'s words', async ($, on) => {
  const w = world(on, true)
  await idleAfterATurn($, w.clock)
  expect(w.asked.some(url => url.endsWith('/api/sessions/sess-1/prompts/next'))).toBe(true)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatchObject({ text: 'continue with the tests' })
  expect(w.submitted[0]?.origin).toMatchObject({ kind: 'plugin', asUser: true })
})

test('nothing is asked of the hub while a turn runs', async ($, on) => {
  const w = world(on, true)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  await w.clock.advance(20_000)
  expect(w.asked.filter(url => url.includes('/prompts/next'))).toEqual([])
})

test('with prompting off, nothing is asked of the hub', async ($, on) => {
  const w = world(on, false)
  await idleAfterATurn($, w.clock)
  await w.clock.advance(20_000)
  expect(w.asked.filter(url => url.includes('/prompts/next'))).toEqual([])
  expect(w.submitted).toEqual([])
})

test("a board prompt that is one of the session's slash commands runs as that command, not as a prompt", async ($, on) => {
  const w = world(on, true, '/reload-plugins')
  await idleAfterATurn($, w.clock)
  expect(w.ran).toEqual([{ command: 'reload-plugins', args: '' }])
  expect(w.submitted).toEqual([])
})

test("a session's prompt is framed as the plugin's and never runs as a command, even one that looks like it", async ($, on) => {
  const w = world(on, true, '/clear', 'session')
  await idleAfterATurn($, w.clock)
  expect(w.ran).toEqual([])
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatchObject({ text: '> /clear' })
  expect(w.submitted[0]?.origin).toMatchObject({ kind: 'plugin' })
  expect((w.submitted[0]?.origin as { asUser?: boolean }).asUser).toBeUndefined()
})

test("a prompt that does not say who wrote it is framed as the plugin's, not the person's words", async ($, on) => {
  const w = world(on, true, '/reload-plugins', null)
  await idleAfterATurn($, w.clock)
  expect(w.ran).toEqual([])
  expect((w.submitted[0]?.origin as { asUser?: boolean }).asUser).toBeUndefined()
})

