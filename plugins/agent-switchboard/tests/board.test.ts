import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

type Fake = { id: string; usd: number; failWrites: boolean; files: Map<string, string>; settings?: string }

// The world beneath the mod: one session, its spend, an environment and a file system that records
// writes. On Windows the engine resolves `/home/u` as `D:/home/u`, so paths are compared without it.
function world(on: On, env: Record<string, string> = { HOME: '/home/u' }) {
  const fake: Fake = { id: 'sess-1', usd: 0, failWrites: false, files: new Map() }
  const clock = mock.clock(on)
  mock.env(on, env)
  on('session.id', () => ({ value: fake.id }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.usage', () => ({ value: { startedAt: Date.UTC(2026, 9, 6, 8, 0, 0), context: { window: 200_000 }, rateLimits: [], cost: { usd: fake.usd } } as never }))
  on('fs.write', ($, e) => {
    if (fake.failWrites) return { deny: 'EACCES' }
    fake.files.set(e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''), e.text)
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
    if (fake.settings !== undefined && path.endsWith('/.agent-switchboard/settings.json')) return { value: fake.settings }
    const written = fake.files.get(path)
    return written === undefined ? { deny: `ENOENT ${e.path}` } : { value: written }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const snapshot = (id = fake.id) => {
    const text = fake.files.get(`/home/u/.agent-switchboard/sessions/${id}.json`)
    return text === undefined ? undefined : JSON.parse(text)
  }
  return { fake, clock, snapshot }
}

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as never
const DONE = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

test('a session publishes its snapshot at start, marked as a Claude Code session', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(w.snapshot()).toMatchObject({ formatVersion: 1, tool: 'claude-code', sessionId: 'sess-1', cwd: '/repo', state: 'idle', cost: 0 })
})

test('running during a turn, idle after it with the spend so far', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  expect(w.snapshot().state).toBe('running')
  w.fake.usd = 0.42
  await $.turn.complete(DONE)
  expect(w.snapshot()).toMatchObject({ state: 'idle', cost: 0.42 })
})

test('an AskUserQuestion shows as waiting with its question until it is answered', async ($, on) => {
  const w = world(on)
  let during: unknown
  on('tool.call', () => {
    during = w.snapshot()
    return { result: { answers: {} } as never }
  })
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  await $.tool.call({
    tool: 'AskUserQuestion',
    tool_use_id: 'q1',
    questions: [
      { question: 'Which library?', header: 'Lib', options: [], multiSelect: false },
      { question: 'And the second?', header: 'Two', options: [], multiSelect: false },
    ],
  } as never)
  expect(during).toMatchObject({ state: 'waiting', openAsk: { question: 'Which library?', count: 2 } })
  expect(w.snapshot().state).toBe('running')
  expect(w.snapshot().openAsk).toBeUndefined()
})

// Holds a Bash call open after its permission check answered `ask`, as the engine does while the
// mode's decider (a prompt, or auto mode's classifier) has not decided.
async function openCall($: Engine, on: On, w: ReturnType<typeof world>, agentId?: string) {
  let release = () => {}
  // The engine's lib is es2023, which has no Promise.withResolvers.
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  on('tool.check', () => ({ decision: 'ask' }))
  on('tool.call', async () => {
    await gate
    return { deny: 'The user denied it' }
  })
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'git push' } as never)
  await w.clock.settle()
  await $.tool.check({ tool: 'Bash', input: { command: 'git push' }, tool_use_id: 'b1', ...(agentId ? { agentId } : {}) } as never)
  return async () => {
    release()
    await call
  }
}

test('a call still undecided 10 seconds after its check answered ask is a prompt waiting on the human', async ($, on) => {
  const w = world(on)
  const finish = await openCall($, on, w)
  const askedAt = w.clock.now()
  await w.clock.advance(9_900)
  expect(w.snapshot().state).toBe('running')
  await w.clock.advance(200)
  expect(w.snapshot()).toMatchObject({ state: 'waiting', openAsk: { question: 'Allow Bash: git push?', count: 1 } })
  // Asked when the prompt opened, not when the board learned of it.
  expect(Date.parse(w.snapshot().openAsk.since)).toBe(askedAt)
  await finish()
  expect(w.snapshot().state).toBe('running')
})

test('a call decided within 10 seconds, as auto mode decides, never shows as waiting', async ($, on) => {
  const w = world(on)
  const finish = await openCall($, on, w)
  await w.clock.advance(9_000)
  await finish()
  await w.clock.advance(10_000)
  expect(w.snapshot().state).toBe('running')
})

test("the delay is the board's setting, board.promptDelaySeconds", async ($, on) => {
  const w = world(on)
  w.fake.settings = JSON.stringify({ board: { promptDelaySeconds: 3 } })
  const finish = await openCall($, on, w)
  await w.clock.advance(2_900)
  expect(w.snapshot().state).toBe('running')
  await w.clock.advance(200)
  expect(w.snapshot().state).toBe('waiting')
  await finish()
})

// The "run in background" pill is drawn only while an allowed Bash command runs.
const PILL = { plugin: 'agent-switchboard', surface: 'terminal', component: 'ToolProgress', props: { tool_use_id: 'b1', kind: 'background_hint', hint: '(ctrl+b to run in background)' } } as never

test('a long command that starts running after approval stops waiting, though it has not finished', async ($, on) => {
  const w = world(on)
  on('ui.render', () => h('Text', null, 'pill') as never)
  const finish = await openCall($, on, w)
  await w.clock.advance(20_000)
  expect(w.snapshot().state).toBe('waiting')
  await $.ui.mount(PILL)
  await w.clock.settle()
  expect(w.snapshot().state).toBe('running')
  await finish()
})

test('a command already running when the delay passes never shows as waiting', async ($, on) => {
  const w = world(on)
  on('ui.render', () => h('Text', null, 'pill') as never)
  const finish = await openCall($, on, w)
  await w.clock.advance(3_000)
  await $.ui.mount(PILL)
  await w.clock.advance(60_000)
  expect(w.snapshot().state).toBe('running')
  await finish()
})

test("a subagent's undecided call is not the main session's wait", async ($, on) => {
  const w = world(on)
  const finish = await openCall($, on, w, 'sub')
  await w.clock.advance(10_000)
  expect(w.snapshot().state).toBe('running')
  await finish()
})

test("a subagent's tool calls and turn ends leave the main session's snapshot alone", async ($, on) => {
  const w = world(on)
  on('tool.check', () => ({ decision: 'ask' }))
  on('tool.call', () => ({ result: {} as never }))
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  const before = w.snapshot()
  await w.clock.advance(1000)
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q', questions: [{ question: '?' }], agentId: 'sub' } as never)
  await $.tool.check({ tool: 'Bash', input: {}, tool_use_id: 's', agentId: 'sub' } as never)
  await $.turn.complete({ ...DONE, agentId: 'sub' } as never)
  expect(w.snapshot()).toEqual(before)
  expect([...w.fake.files.keys()]).toHaveLength(1)
})

test('task tools move the todo progress', async ($, on) => {
  const w = world(on)
  on('tool.call', ($, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: '1', subject: 'Write it' } } as never } : { result: {} as never }))
  await $.session.start(START)
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 'c', subject: 'Write it', description: 'd' } as never)
  expect(w.snapshot().todo).toEqual({ closed: 0, total: 1, current: 'Write it' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'u', taskId: '1', status: 'completed' } as never)
  expect(w.snapshot().todo).toEqual({ closed: 1, total: 1 })
})

test('a heartbeat every 15 seconds, and the spend it finds', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const first = w.snapshot().heartbeatAt
  w.fake.usd = 1.5
  await w.clock.advance(15_000)
  expect(Date.parse(w.snapshot().heartbeatAt) - Date.parse(first)).toBe(15_000)
  expect(w.snapshot().cost).toBe(1.5)
})

test('a /clear ends the session, and the new id gets its own snapshot', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } } as never)
  expect(w.snapshot('sess-1')).toMatchObject({ endReason: 'clear' })
  expect(w.snapshot('sess-1').endedAt).toBeDefined()
  w.fake.id = 'sess-2'
  await w.clock.advance(15_000)
  expect(w.snapshot('sess-2')).toMatchObject({ sessionId: 'sess-2', state: 'idle' })
  expect(w.snapshot('sess-1').endReason).toBe('clear')
})

test('SWITCHBOARD_HOME relocates the snapshots', async ($, on) => {
  const w = world(on, { HOME: '/home/u', SWITCHBOARD_HOME: '/data/board' })
  await $.session.start(START)
  expect([...w.fake.files.keys()]).toEqual(['/data/board/sessions/sess-1.json'])
})

test('a failed write never reaches the session: the tool still runs and answers', async ($, on) => {
  const w = world(on)
  w.fake.failWrites = true
  on('tool.call', () => ({ result: { ok: true } as never }))
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  const r = await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'ls' } as never)
  expect(r).toMatchObject({ result: { ok: true } })
  await $.turn.complete(DONE)
})

test("what the session last said: the main loop's answer, never a subagent's", async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  await $.turn.complete({ ...DONE, answer: 'Subagent chatter', agentId: 'sub' } as never)
  expect(w.snapshot().lastSaid).toBeUndefined()
  await $.turn.complete({ ...DONE, answer: 'All tests pass now.' })
  expect(w.snapshot().lastSaid).toMatchObject({ text: 'All tests pass now.' })
})

test('the snapshot says when the session started, as Claude Code counts it', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(w.snapshot().startedAt).toBe('2026-10-06T08:00:00.000Z')
})


test("the main loop's full answer goes beside the snapshot, for the project page", async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  await $.turn.complete({ ...DONE, answer: '**Done.**\n\n- one\n- two' })
  expect(w.fake.files.get('/home/u/.agent-switchboard/said/sess-1.md')).toBe('**Done.**\n\n- one\n- two')
})

test("each main turn that said something joins the session's turn history; a subagent's does not", async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  await $.turn.complete({ ...DONE, answer: 'Subagent chatter', agentId: 'sub' } as never)
  await $.turn.complete({ ...DONE, answer: 'First conclusion.' })
  await $.turn.complete({ ...DONE, answer: 'Second conclusion.' })
  const turns = JSON.parse(w.fake.files.get('/home/u/.agent-switchboard/said/sess-1.turns.json') ?? '[]') as Array<{ text: string }>
  expect(turns.map(t => t.text)).toEqual(['First conclusion.', 'Second conclusion.'])
})
