// A Claude Code session's state as Agent Switchboard sees it, and the only way it changes.
//
// Pure: no `$`, no files, no clock. `register.ts` turns hook events into `SessionEvent`s with the
// time attached, so every rule here is testable on its own. Times are epoch milliseconds. The omp
// extension's `state.ts` in the agent-switchboard repository is the model this follows.

import { isRecord } from './guards'

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface Waiting {
  toolUseId: string
  /** The first question of an AskUserQuestion, or what a permission prompt asks. */
  question: string
  count: number
  since: number
}

export interface TodoProgress {
  closed: number
  total: number
  /** The task in progress, or the first pending one. */
  current?: string
}

export interface SessionState {
  sessionId: string
  cwd: string
  agentDir: string
  pid: number
  phase: 'idle' | 'running'
  /** Everything waiting on the human, oldest first: tool calls can run concurrently. */
  waiting: Waiting[]
  /** The task tools' list, by task id; TodoWrite replaces `todo` directly instead. */
  tasks: Record<string, { subject: string; status: TaskStatus }>
  todo?: TodoProgress
  cost: number
  lastActivityAt: number
  heartbeatAt: number
  ended?: { at: number; reason: string }
}

export type SessionEvent =
  | { type: 'turn_started'; at: number }
  | { type: 'turn_ended'; at: number }
  | { type: 'ask_opened'; toolUseId: string; questions: string[]; at: number }
  | { type: 'permission_asked'; toolUseId: string; question: string; at: number }
  | { type: 'tool_finished'; toolUseId: string; at: number }
  | { type: 'task_created'; id: string; subject: string; at: number }
  | { type: 'task_updated'; id: string; status?: TaskStatus | 'deleted'; subject?: string; at: number }
  | { type: 'todos_written'; todos: Array<{ content: string; status: TaskStatus }>; at: number }
  | { type: 'cost_seen'; usd: number; at: number }
  | { type: 'heartbeat'; at: number }
  | { type: 'session_ended'; reason: string; at: number }

export interface SessionStart {
  sessionId: string
  cwd: string
  agentDir: string
  pid: number
  /** Spend already recorded in the session when the mod started watching it. */
  cost: number
  at: number
}

export function startSession(start: SessionStart): SessionState {
  return {
    sessionId: start.sessionId,
    cwd: start.cwd,
    agentDir: start.agentDir,
    pid: start.pid,
    phase: 'idle',
    waiting: [],
    tasks: {},
    cost: start.cost,
    lastActivityAt: start.at,
    heartbeatAt: start.at,
  }
}

export function next(state: SessionState, event: SessionEvent): SessionState {
  if (state.ended) return state
  const touched = { ...state, heartbeatAt: event.at }
  const active = { ...touched, lastActivityAt: event.at }

  switch (event.type) {
    case 'heartbeat':
      return touched
    case 'cost_seen':
      return { ...touched, cost: event.usd }
    case 'turn_started':
      return { ...active, phase: 'running' }
    case 'turn_ended':
      // Once the turn has settled nothing can still be asking: an interrupted prompt may end
      // without its tool call ever resolving.
      return { ...active, phase: 'idle', waiting: [] }
    case 'ask_opened': {
      const [first = ''] = event.questions
      const others = state.waiting.filter(w => w.toolUseId !== event.toolUseId)
      return { ...active, waiting: [...others, { toolUseId: event.toolUseId, question: first, count: event.questions.length, since: event.at }] }
    }
    case 'permission_asked':
      // AskUserQuestion is itself put to the permission check; its question says more.
      if (state.waiting.some(w => w.toolUseId === event.toolUseId)) return active
      return { ...active, waiting: [...state.waiting, { toolUseId: event.toolUseId, question: event.question, count: 1, since: event.at }] }
    case 'tool_finished':
      return { ...active, waiting: state.waiting.filter(w => w.toolUseId !== event.toolUseId) }
    case 'task_created':
      return withTasks(active, { ...state.tasks, [event.id]: { subject: event.subject, status: 'pending' } })
    case 'task_updated': {
      const task = state.tasks[event.id]
      if (!task) return active
      const { [event.id]: _old, ...rest } = state.tasks
      if (event.status === 'deleted') return withTasks(active, rest)
      return withTasks(active, { ...rest, [event.id]: { subject: event.subject ?? task.subject, status: event.status ?? task.status } })
    }
    case 'todos_written':
      return withTodo(active, progressOf(event.todos.map(t => ({ subject: t.content, status: t.status }))))
    case 'session_ended':
      return { ...touched, phase: 'idle', waiting: [], ended: { at: event.at, reason: event.reason } }
  }
}

/** What the board shows for a permission prompt: the tool, and what it would act on when that is plain. */
export function permissionQuestion(tool: string, input: unknown): string {
  const detail = detailOf(input)
  return detail ? `Allow ${tool}: ${detail}?` : `Allow ${tool}?`
}

function detailOf(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  for (const key of ['description', 'command', 'file_path', 'notebook_path', 'url', 'pattern']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim().split('\n')[0]
  }
  return undefined
}

function withTasks(state: SessionState, tasks: SessionState['tasks']): SessionState {
  // Task ids are counters, so their numeric order is the order they were created in.
  const ordered = Object.entries(tasks)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, task]) => task)
  return withTodo({ ...state, tasks }, progressOf(ordered))
}

function withTodo(state: SessionState, todo: TodoProgress | undefined): SessionState {
  const { todo: _previous, ...rest } = state
  return todo ? { ...rest, todo } : rest
}

function progressOf(tasks: Array<{ subject: string; status: TaskStatus }>): TodoProgress | undefined {
  if (tasks.length === 0) return undefined
  const closed = tasks.filter(t => t.status === 'completed').length
  const current = tasks.find(t => t.status === 'in_progress') ?? tasks.find(t => t.status === 'pending')
  const progress: TodoProgress = { closed, total: tasks.length }
  if (current) progress.current = current.subject
  return progress
}
