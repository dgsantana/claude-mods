import type { On } from 'claude-code'
import { type Engine, expect, type MockClock, mock, test } from 'claude-code/testing'

// A hub beneath the mod: its token, the prompts offered to it, answers the test gives, and withdrawals.
// A round of waiting for an answer is held until the test answers or the prompt is withdrawn.
function hub(on: On) {
  const state = {
    offered: [] as Array<Record<string, unknown>>,
    withdrawn: [] as string[],
    waiting: new Map<string, (text: string | undefined) => void>(),
    ready: new Map<string, string>(),
  }
  const reply = (status: number, text = '') => ({ value: { status, ok: status < 300, headers: {}, text } })
  on('http.fetch', async ($, e) => {
    const url = new URL(e.url)
    const method = e.init?.method ?? 'GET'
    if (url.pathname === '/api/token') return reply(200, '{"token":"tok"}')
    // As the hub will once every session sends it: no request but the token's own without the token.
    if (e.init?.headers?.['x-hub-token'] !== 'tok') return reply(403)
    if (url.pathname === '/api/prompts' && method === 'POST') {
      state.offered.push(JSON.parse(e.init?.body ?? '{}'))
      return reply(204)
    }
    const answer = /^\/api\/prompts\/([^/]+)\/answer$/.exec(url.pathname)
    if (answer?.[1] && method === 'GET') {
      const id = decodeURIComponent(answer[1])
      const ready = state.ready.get(id)
      if (ready !== undefined) {
        state.ready.delete(id)
        return reply(200, ready)
      }
      const text = await new Promise<string | undefined>(resolve => state.waiting.set(id, resolve))
      return text === undefined ? reply(404) : reply(200, text)
    }
    const prompt = /^\/api\/prompts\/([^/]+)$/.exec(url.pathname)
    if (prompt?.[1] && method === 'DELETE') {
      const id = decodeURIComponent(prompt[1])
      state.withdrawn.push(id)
      state.waiting.get(id)?.(undefined)
      return reply(204)
    }
    return reply(404)
  })
  const answer = (id: string, body: unknown) => {
    const text = JSON.stringify(body)
    const waiter = state.waiting.get(id)
    if (waiter) {
      state.waiting.delete(id)
      waiter(text)
    } else state.ready.set(id, text)
  }
  return { state, answer }
}

function session(on: On) {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/u' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } } as never }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', ($, e) => ({ deny: `ENOENT ${e.path}` }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('tool.check', () => ({ decision: 'ask' }))
  return clock
}

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as never

// Opens a call the terminal has not answered, and asks its permission check, as the engine does.
async function open($: Engine, clock: MockClock, call: Record<string, unknown>) {
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  const pending = $.tool.call(call as never)
  await clock.settle()
  const { tool, tool_use_id: id, ...input } = call
  await $.tool.check({ tool, input, tool_use_id: id } as never)
  await clock.settle()
  // Wrapped: an async function returning the promise itself would wait for the call to resolve.
  return { pending }
}

// The terminal's side: held until released, then the terminal's own answer.
function terminal(own: () => unknown) {
  let release = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  return { gate, release, own }
}

test('the board denies a prompt: the call is denied with the board as its reason', async ($, on) => {
  const clock = session(on)
  const h = hub(on)
  const t = terminal(() => ({ result: { stdout: 'ran' } }))
  on('tool.call', async () => {
    await t.gate
    return t.own() as never
  })
  const { pending } = await open($, clock, { tool: 'Bash', tool_use_id: 'b1', command: 'git push', description: 'Push it' })
  expect(h.state.offered).toMatchObject([{ id: 'b1', sessionId: 'sess-1', kind: 'permission', tool: 'Bash', description: 'Push it', input: 'git push' }])
  h.answer('b1', { decision: 'deny', note: 'use staging' })
  expect(await pending).toEqual({ deny: 'Denied from Agent Switchboard: use staging' })
  t.release()
})

test('the board allows a prompt once: the same call runs again as the plugin\'s own, and that is the result', async ($, on) => {
  const clock = session(on)
  const h = hub(on)
  const t = terminal(() => ({ result: { stdout: 'terminal' } }))
  const reruns: Array<Record<string, unknown>> = []
  on('tool.call', async ($, e) => {
    if (e.tool_use_id === 'b1') {
      await t.gate
      return t.own() as never
    }
    reruns.push({ ...e })
    return { result: { stdout: 'ran once' } } as never
  })
  const { pending } = await open($, clock, { tool: 'Bash', tool_use_id: 'b1', command: 'git push', description: 'Push it' })
  h.answer('b1', { decision: 'allow' })
  expect(await pending).toMatchObject({ result: { stdout: 'ran once' } })
  expect(reruns).toHaveLength(1)
  expect(reruns[0]).toMatchObject({ tool: 'Bash', command: 'git push', description: 'Push it' })
  t.release()
})

test("the board answers a question form: its answers are the call's result", async ($, on) => {
  const clock = session(on)
  const h = hub(on)
  const t = terminal(() => ({ result: {} }))
  on('tool.call', async () => {
    await t.gate
    return t.own() as never
  })
  const questions = [{ question: 'Colour?', header: 'C', options: [{ label: 'Red' }, { label: 'Blue' }], multiSelect: false }]
  const { pending } = await open($, clock, { tool: 'AskUserQuestion', tool_use_id: 'q1', questions })
  expect(h.state.offered).toMatchObject([{ id: 'q1', kind: 'question', questions: [{ question: 'Colour?', options: ['Red', 'Blue'] }] }])
  h.answer('q1', { answers: { 'Colour?': 'Blue' } })
  expect(await pending).toMatchObject({ result: { questions, answers: { 'Colour?': 'Blue' } } })
  t.release()
})

test('the terminal answers first: its answer stands and the prompt is withdrawn from the board', async ($, on) => {
  const clock = session(on)
  const h = hub(on)
  const t = terminal(() => ({ result: { stdout: 'terminal' } }))
  on('tool.call', async () => {
    await t.gate
    return t.own() as never
  })
  const { pending } = await open($, clock, { tool: 'Bash', tool_use_id: 'b1', command: 'ls' })
  t.release()
  expect(await pending).toMatchObject({ result: { stdout: 'terminal' } })
  await clock.settle()
  expect(h.state.withdrawn).toEqual(['b1'])
})

test('with no hub the terminal answers as if the board did not exist', async ($, on) => {
  const clock = session(on)
  on('http.fetch', () => ({ deny: 'ECONNREFUSED' }))
  const t = terminal(() => ({ result: { stdout: 'terminal' } }))
  on('tool.call', async () => {
    await t.gate
    return t.own() as never
  })
  const { pending } = await open($, clock, { tool: 'Bash', tool_use_id: 'b1', command: 'ls' })
  t.release()
  expect(await pending).toMatchObject({ result: { stdout: 'terminal' } })
})
