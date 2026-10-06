import { describe, expect, test } from 'bun:test'
import { next, permissionQuestion, type SessionState, startSession } from '../hooks/state'

const T0 = Date.UTC(2026, 9, 6, 10, 0, 0)

function fresh(): SessionState {
  return startSession({ sessionId: 's1', cwd: '/repo', agentDir: '/home/u/.claude', pid: 0, cost: 0.5, at: T0 })
}

describe('a session', () => {
  test('starts idle with the spend already recorded', () => {
    const s = fresh()
    expect(s.phase).toBe('idle')
    expect(s.cost).toBe(0.5)
    expect(s.waiting).toEqual([])
    expect(s.lastActivityAt).toBe(T0)
  })

  test('is running from the start of a turn to its end', () => {
    const running = next(fresh(), { type: 'turn_started', at: T0 + 1 })
    expect(running.phase).toBe('running')
    const done = next(running, { type: 'turn_ended', at: T0 + 2 })
    expect(done.phase).toBe('idle')
    expect(done.lastActivityAt).toBe(T0 + 2)
  })

  test('waits on an AskUserQuestion until that call finishes', () => {
    let s = next(fresh(), { type: 'turn_started', at: T0 + 1 })
    s = next(s, { type: 'ask_opened', toolUseId: 'q', questions: ['Which one?', 'And this?'], at: T0 + 2 })
    expect(s.waiting).toEqual([{ toolUseId: 'q', question: 'Which one?', count: 2, since: T0 + 2 }])
    s = next(s, { type: 'tool_finished', toolUseId: 'other', at: T0 + 3 })
    expect(s.waiting).toHaveLength(1)
    s = next(s, { type: 'tool_finished', toolUseId: 'q', at: T0 + 4 })
    expect(s.waiting).toEqual([])
    expect(s.phase).toBe('running')
  })

  test('waits on a permission prompt until that call finishes, allowed or denied', () => {
    let s = next(fresh(), { type: 'permission_asked', toolUseId: 'b', question: 'Allow Bash: git push?', at: T0 + 1 })
    expect(s.waiting).toEqual([{ toolUseId: 'b', question: 'Allow Bash: git push?', count: 1, since: T0 + 1 }])
    s = next(s, { type: 'tool_finished', toolUseId: 'b', at: T0 + 2 })
    expect(s.waiting).toEqual([])
  })

  test('a permission check on a call already asking the human keeps the question', () => {
    let s = next(fresh(), { type: 'ask_opened', toolUseId: 'q', questions: ['Which one?'], at: T0 + 1 })
    s = next(s, { type: 'permission_asked', toolUseId: 'q', question: 'Allow AskUserQuestion?', at: T0 + 2 })
    expect(s.waiting).toEqual([{ toolUseId: 'q', question: 'Which one?', count: 1, since: T0 + 1 }])
  })

  test('keeps concurrent waits in the order they opened', () => {
    let s = next(fresh(), { type: 'permission_asked', toolUseId: 'a', question: 'Allow A?', at: T0 + 1 })
    s = next(s, { type: 'permission_asked', toolUseId: 'b', question: 'Allow B?', at: T0 + 2 })
    expect(s.waiting.map(w => w.toolUseId)).toEqual(['a', 'b'])
    s = next(s, { type: 'tool_finished', toolUseId: 'a', at: T0 + 3 })
    expect(s.waiting.map(w => w.toolUseId)).toEqual(['b'])
  })

  test('nothing can still be waiting once the turn has ended', () => {
    let s = next(fresh(), { type: 'ask_opened', toolUseId: 'q', questions: ['?'], at: T0 + 1 })
    s = next(s, { type: 'turn_ended', at: T0 + 2 })
    expect(s.waiting).toEqual([])
  })

  test('heartbeats move the heartbeat, not the last activity', () => {
    const s = next(fresh(), { type: 'heartbeat', at: T0 + 15_000 })
    expect(s.heartbeatAt).toBe(T0 + 15_000)
    expect(s.lastActivityAt).toBe(T0)
  })

  test('takes the spend the session reports, without counting it as activity', () => {
    const s = next(fresh(), { type: 'cost_seen', usd: 1.25, at: T0 + 5 })
    expect(s.cost).toBe(1.25)
    expect(s.lastActivityAt).toBe(T0)
  })

  test('once ended, it records why and changes no further', () => {
    let s = next(fresh(), { type: 'ask_opened', toolUseId: 'q', questions: ['?'], at: T0 + 1 })
    s = next(s, { type: 'session_ended', reason: 'clear', at: T0 + 2 })
    expect(s.ended).toEqual({ at: T0 + 2, reason: 'clear' })
    expect(s.waiting).toEqual([])
    expect(next(s, { type: 'turn_started', at: T0 + 3 })).toBe(s)
  })
})

describe('todo progress', () => {
  test('follows the task tools: created, then moved through their statuses', () => {
    let s = next(fresh(), { type: 'task_created', id: '1', subject: 'Write the spec', at: T0 + 1 })
    s = next(s, { type: 'task_created', id: '2', subject: 'Build it', at: T0 + 2 })
    expect(s.todo).toEqual({ closed: 0, total: 2, current: 'Write the spec' })
    s = next(s, { type: 'task_updated', id: '2', status: 'in_progress', at: T0 + 3 })
    expect(s.todo).toEqual({ closed: 0, total: 2, current: 'Build it' })
    s = next(s, { type: 'task_updated', id: '1', status: 'completed', at: T0 + 4 })
    expect(s.todo).toEqual({ closed: 1, total: 2, current: 'Build it' })
  })

  test('a deleted task leaves the count; the last one leaving clears the progress', () => {
    let s = next(fresh(), { type: 'task_created', id: '1', subject: 'Only', at: T0 + 1 })
    s = next(s, { type: 'task_updated', id: '1', status: 'deleted', at: T0 + 2 })
    expect(s.todo).toBeUndefined()
  })

  test('an update renames a task, and an update to an unknown task is ignored', () => {
    let s = next(fresh(), { type: 'task_created', id: '1', subject: 'Old', at: T0 + 1 })
    s = next(s, { type: 'task_updated', id: '1', subject: 'New', at: T0 + 2 })
    s = next(s, { type: 'task_updated', id: '9', status: 'completed', at: T0 + 3 })
    expect(s.todo).toEqual({ closed: 0, total: 1, current: 'New' })
  })

  test('follows a TodoWrite list as a whole', () => {
    const s = next(fresh(), {
      type: 'todos_written',
      todos: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ],
      at: T0 + 1,
    })
    expect(s.todo).toEqual({ closed: 1, total: 3, current: 'b' })
  })

  test('all done has no current task', () => {
    const s = next(fresh(), { type: 'todos_written', todos: [{ content: 'a', status: 'completed' }], at: T0 + 1 })
    expect(s.todo).toEqual({ closed: 1, total: 1 })
  })
})

describe('the question a permission prompt shows on the board', () => {
  test('names the tool and what it would do', () => {
    expect(permissionQuestion('Bash', { command: 'git push', description: 'Push to origin' })).toBe('Allow Bash: Push to origin?')
    expect(permissionQuestion('Bash', { command: 'git push' })).toBe('Allow Bash: git push?')
    expect(permissionQuestion('Edit', { file_path: '/repo/a.ts', old_string: 'x' })).toBe('Allow Edit: /repo/a.ts?')
    expect(permissionQuestion('WebFetch', { url: 'https://example.com', prompt: 'p' })).toBe('Allow WebFetch: https://example.com?')
  })

  test('is the tool alone when its input names nothing useful', () => {
    expect(permissionQuestion('mcp__x__y', { a: 1 })).toBe('Allow mcp__x__y?')
    expect(permissionQuestion('Bash', null)).toBe('Allow Bash?')
  })
})
