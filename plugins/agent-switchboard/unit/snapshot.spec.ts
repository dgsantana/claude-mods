import { describe, expect, test } from 'bun:test'
import { agentDirOf, boardHomeOf, MAX_SAID_CHARS, saidPathOf, saidTextOf, snapshotPathOf, toSnapshot } from '../hooks/snapshot'
import { next, startSession } from '../hooks/state'

const T0 = Date.UTC(2026, 9, 6, 10, 0, 0)
const start = () => startSession({ sessionId: 's1', cwd: '/repo', agentDir: '/home/u/.claude', pid: 0, cost: 0, at: T0 })

describe('the snapshot, format v1 as the Agent Switchboard hub reads it', () => {
  test('a fresh session: the required fields, tool set, absent values omitted', () => {
    expect(toSnapshot(start())).toEqual({
      formatVersion: 1,
      tool: 'claude-code',
      sessionId: 's1',
      cwd: '/repo',
      agentDir: '/home/u/.claude',
      pid: 0,
      state: 'idle',
      lastActivityAt: '2026-10-06T10:00:00.000Z',
      heartbeatAt: '2026-10-06T10:00:00.000Z',
      cost: 0,
    })
  })

  test('waiting shows the oldest open question, with the count it carries', () => {
    let s = next(start(), { type: 'turn_started', at: T0 })
    s = next(s, { type: 'permission_asked', toolUseId: 'a', question: 'Allow Bash?', at: T0 + 1000 })
    s = next(s, { type: 'ask_opened', toolUseId: 'b', questions: ['x?', 'y?'], at: T0 + 2000 })
    const snap = toSnapshot(s)
    expect(snap.state).toBe('waiting')
    expect(snap.openAsk).toEqual({ question: 'Allow Bash?', count: 1, since: '2026-10-06T10:00:01.000Z' })
  })

  test('running while a turn is under way and nothing waits', () => {
    expect(toSnapshot(next(start(), { type: 'turn_started', at: T0 })).state).toBe('running')
  })

  test('an ended session carries when and why', () => {
    const snap = toSnapshot(next(start(), { type: 'session_ended', reason: 'prompt_input_exit', at: T0 + 5000 }))
    expect(snap.endedAt).toBe('2026-10-06T10:00:05.000Z')
    expect(snap.endReason).toBe('prompt_input_exit')
  })

  test('long text is cut to its limit and marked, so the file stays small', () => {
    let s = next(start(), { type: 'ask_opened', toolUseId: 'a', questions: ['q'.repeat(1000)], at: T0 })
    s = next(s, { type: 'task_created', id: '1', subject: 't'.repeat(500), at: T0 })
    const snap = toSnapshot(s)
    expect(snap.openAsk?.question).toHaveLength(300)
    expect(snap.openAsk?.question.endsWith('…')).toBe(true)
    expect(snap.todo?.current).toHaveLength(120)
    expect(JSON.stringify(snap).length).toBeLessThan(4096)
  })
})

describe('where the snapshot goes', () => {
  test('the board home is SWITCHBOARD_HOME when set, else .agent-switchboard in the home folder', () => {
    expect(boardHomeOf({ SWITCHBOARD_HOME: '/data/board', HOME: '/home/u' })).toBe('/data/board')
    expect(boardHomeOf({ HOME: '/home/u' })).toBe('/home/u/.agent-switchboard')
    expect(boardHomeOf({ USERPROFILE: 'C:\\Users\\u' })).toBe('C:\\Users\\u\\.agent-switchboard')
    expect(boardHomeOf({})).toBeUndefined()
  })

  test('the agent folder is CLAUDE_CONFIG_DIR when set, else .claude in the home folder', () => {
    expect(agentDirOf({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' })).toBe('/cfg')
    expect(agentDirOf({ USERPROFILE: 'C:\\Users\\u' })).toBe('C:\\Users\\u\\.claude')
    expect(agentDirOf({})).toBe('')
  })

  test('one file per session under sessions/, and only for an id that can name nothing else', () => {
    expect(snapshotPathOf('/home/u/.agent-switchboard', '8d75d91f-79d0-40f9-96c4-d05bfd6c2936')).toBe(
      '/home/u/.agent-switchboard/sessions/8d75d91f-79d0-40f9-96c4-d05bfd6c2936.json',
    )
    expect(snapshotPathOf('C:\\b', 'abc')).toBe('C:\\b\\sessions\\abc.json')
    expect(snapshotPathOf('/b', '../escape')).toBeUndefined()
    expect(snapshotPathOf('/b', 'a/b')).toBeUndefined()
    expect(snapshotPathOf('/b', '')).toBeUndefined()
  })
})

describe('what the session last said, in the snapshot', () => {
  test('a long answer keeps its end, where the conclusion is, within 400 characters', () => {
    const said = `${'a'.repeat(1000)} The fix is in.`
    const snap = toSnapshot(next(start(), { type: 'turn_ended', said, at: T0 + 1000 }))
    expect(snap.lastSaid?.text).toHaveLength(400)
    expect(snap.lastSaid?.text.startsWith('…')).toBe(true)
    expect(snap.lastSaid?.text.endsWith('The fix is in.')).toBe(true)
    expect(snap.lastSaid?.at).toBe('2026-10-06T10:00:01.000Z')
  })

  test('absent until something is said', () => {
    expect(toSnapshot(start()).lastSaid).toBeUndefined()
  })
})

describe('when the session started, in the snapshot', () => {
  test('is published when known', () => {
    const started = startSession({ sessionId: 's1', cwd: '/repo', agentDir: '/a', pid: 0, cost: 0, startedAt: T0 - 60_000, at: T0 })
    expect(toSnapshot(started).startedAt).toBe('2026-10-06T09:59:00.000Z')
  })

  test('absent when not known', () => {
    expect(toSnapshot(start()).startedAt).toBeUndefined()
  })
})

describe('the full last answer, beside the snapshot', () => {
  test('goes to said/<session>.md in the board folder, only for an id that can name nothing else', () => {
    expect(saidPathOf('/home/u/.agent-switchboard', 'abc-1')).toBe('/home/u/.agent-switchboard/said/abc-1.md')
    expect(saidPathOf('C:\\b', 'abc')).toBe('C:\\b\\said\\abc.md')
    expect(saidPathOf('/b', '../x')).toBeUndefined()
  })

  test('keeps the whole answer up to 64 KB, else its end, marked', () => {
    expect(saidTextOf('short')).toBe('short')
    const long = saidTextOf(`${'a'.repeat(MAX_SAID_CHARS)}THE END`)
    expect(long).toHaveLength(MAX_SAID_CHARS)
    expect(long.startsWith('…')).toBe(true)
    expect(long.endsWith('THE END')).toBe(true)
  })
})
