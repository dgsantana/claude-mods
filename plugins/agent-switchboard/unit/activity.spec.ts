import { describe, expect, test } from 'bun:test'
import { activityOf, MAX_ACTIVITY_CHARS } from '../hooks/activity'
import { toSnapshot } from '../hooks/snapshot'
import { next, startSession } from '../hooks/state'

const T0 = Date.UTC(2026, 9, 7, 21, 0, 0)

describe('what a session is doing, from the tool call it started (increment 025)', () => {
  test('file tools name the file, not its folder', () => {
    expect(activityOf('Edit', { file_path: 'D:\\dev\\p\\src\\state.ts' })).toBe('editing state.ts')
    expect(activityOf('Write', { file_path: '/repo/docs/plan.md' })).toBe('editing plan.md')
    expect(activityOf('NotebookEdit', { notebook_path: '/repo/n.ipynb' })).toBe('editing n.ipynb')
    expect(activityOf('Read', { file_path: '/repo/README.md' })).toBe('reading README.md')
  })

  test('Bash says what the call is for, falling back to the first line of the command', () => {
    expect(activityOf('Bash', { command: 'TOKEN=abc curl https://x', description: 'Fetch the release list' })).toBe('running Fetch the release list')
    expect(activityOf('Bash', { command: 'bun test\nbun run lint' })).toBe('running bun test')
  })

  test('searches, fetches, delegation and skills', () => {
    expect(activityOf('Grep', { pattern: 'session\\.send' })).toBe('searching session\\.send')
    expect(activityOf('Glob', { pattern: '**/*.spec.ts' })).toBe('finding **/*.spec.ts')
    expect(activityOf('WebFetch', { url: 'https://docs.example.com/a/b?q=1' })).toBe('fetching docs.example.com')
    expect(activityOf('WebSearch', { query: 'bun test mock clock' })).toBe('searching the web: bun test mock clock')
    expect(activityOf('Agent', { description: 'Find the hub routes' })).toBe('delegating: Find the hub routes')
    expect(activityOf('Skill', { skill: 'rust' })).toBe('using skill rust')
  })

  test('an MCP tool reads as its tool and server; anything else as its name', () => {
    expect(activityOf('mcp__agent-switchboard__board_write', { ops: [] })).toBe('board_write (agent-switchboard)')
    expect(activityOf('TaskCreate', { subject: 'x' })).toBe('TaskCreate')
    expect(activityOf('Edit', {})).toBe('Edit')
    expect(activityOf('WebFetch', { url: 'not a url' })).toBe('WebFetch')
  })

  test('the text is at most 80 characters, its start kept', () => {
    const long = activityOf('Bash', { description: 'x'.repeat(200) })
    expect(long).toHaveLength(MAX_ACTIVITY_CHARS)
    expect(long.startsWith('running xxx')).toBe(true)
    expect(long.endsWith('…')).toBe(true)
  })

  test('it reaches the snapshot when a call starts, and stays once the turn has ended', () => {
    let state = startSession({ sessionId: 's', cwd: '/r', agentDir: '/a', pid: 0, cost: 0, at: T0 })
    state = next(state, { type: 'turn_started', at: T0 })
    state = next(state, { type: 'tool_started', activity: 'editing state.ts', at: T0 + 1000 })
    state = next(state, { type: 'turn_ended', at: T0 + 2000 })
    expect(toSnapshot(state).activity).toEqual({ text: 'editing state.ts', at: '2026-10-07T21:00:01.000Z' })
    expect(toSnapshot(startSession({ sessionId: 's', cwd: '/r', agentDir: '/a', pid: 0, cost: 0, at: T0 })).activity).toBeUndefined()
  })
})
