// The one hooks module: turns Claude Code's events into omp-board snapshot files and does nothing
// else. The engine follows `$` only into functions declared in this file, so every call on `$` lives
// here; the rules they feed are in `state.ts` and `snapshot.ts`.
//
// This runs inside the user's session. Every hook passes the event on whatever happens to the
// snapshot, and its `.catch` passes it on when the hook itself fails: a failure here costs the board
// an update, never the session its work.

import type { EngineInterface, Register } from 'claude-code'
import { isRecord } from './guards'
import { agentDirOf, boardHomeOf, snapshotPathOf, toSnapshot } from './snapshot'
import { next as advance, permissionQuestion, type SessionEvent, type SessionState, startSession, type TaskStatus } from './state'

const HEARTBEAT_MS = 15_000
const FAILURE_LOG_MS = 60_000

// Module variables reset on a hot reload; the next event or heartbeat starts watching again.
let session: SessionState | undefined
let starting: Promise<SessionState | undefined> | undefined
let heartbeat: { cancel: () => void } | undefined
let writes: Promise<void> = Promise.resolve()
let lastFailureLogAt = Number.NEGATIVE_INFINITY
/**
 * Main-loop calls whose permission check answered `ask`, by tool_use_id, until they resolve. `ask` puts
 * a call to the mode's decider, which in auto mode is a classifier, not a prompt; only the
 * PermissionRequest hook, raised when a prompt is shown, makes one a wait on the human.
 */
const asked = new Map<string, { tool: string; input: string }>()

/** Reported at most once a minute, to the debug log only: never into the conversation. */
async function report($: EngineInterface, error: unknown): Promise<void> {
  const now = await $.clock.now()
  if (now - lastFailureLogAt < FAILURE_LOG_MS) return
  lastFailureLogAt = now
  $.ui.log(`omp-board: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

/**
 * The session being watched, started on first sight of a session id: at `session.start`, after a
 * hot reload, and after a `/clear` or `/resume`, which go on under a new id with no `session.start`.
 * An ended session stays ended until the id changes.
 */
async function current($: EngineInterface): Promise<SessionState | undefined> {
  const id = await $.session.id()
  if (session?.sessionId === id) return session.ended ? undefined : session
  starting ??= begin($, id).finally(() => {
    starting = undefined
  })
  return starting
}

async function begin($: EngineInterface, sessionId: string): Promise<SessionState | undefined> {
  const env = {
    CLAUDE_CONFIG_DIR: await $.env.get('CLAUDE_CONFIG_DIR'),
    USERPROFILE: await $.env.get('USERPROFILE'),
    HOME: await $.env.get('HOME'),
  }
  const usage = await $.session.usage()
  // The mods API offers no process id; the hub does not use it.
  session = startSession({
    sessionId,
    cwd: await $.session.cwd(),
    agentDir: agentDirOf(env),
    pid: 0,
    cost: usage.cost?.usd ?? 0,
    at: await $.clock.now(),
  })
  heartbeat ??= $.clock.every(HEARTBEAT_MS, () => {
    beat($).catch(error => report($, error))
  })
  await publish($, session)
  return session
}

async function beat($: EngineInterface): Promise<void> {
  const state = await current($)
  if (!state) return
  const usage = await $.session.usage()
  const at = await $.clock.now()
  const usd = usage.cost?.usd
  await apply($, usd === undefined || usd === state.cost ? { type: 'heartbeat', at } : { type: 'cost_seen', usd, at })
}

/** Moves the watched session on by one event and publishes it; never throws. */
async function apply($: EngineInterface, event: SessionEvent): Promise<void> {
  try {
    const state = await current($)
    if (!state) return
    session = advance(state, event)
    await publish($, session)
  } catch (error) {
    await report($, error)
  }
}

/**
 * Writes the snapshot in place: the mods API has no rename, so the write is not atomic. The hub skips a
 * file it cannot parse and reads it again on its next refresh. Writes are queued so the file ends as
 * the latest state even when concurrent tool calls publish at once.
 */
async function publish($: EngineInterface, state: SessionState): Promise<void> {
  const home = boardHomeOf({
    OMP_BOARD_HOME: await $.env.get('OMP_BOARD_HOME'),
    USERPROFILE: await $.env.get('USERPROFILE'),
    HOME: await $.env.get('HOME'),
  })
  const path = home && snapshotPathOf(home, state.sessionId)
  if (!path) throw new Error(`no place for the snapshot of session ${state.sessionId}`)
  const text = JSON.stringify(toSnapshot(state))
  const write = writes.then(() => $.fs.write(path, text))
  writes = write.catch(() => {})
  await write
}

function questionsOf(input: unknown): string[] {
  if (!isRecord(input) || !Array.isArray(input.questions)) return []
  return input.questions.flatMap(item => (isRecord(item) && typeof item.question === 'string' ? [item.question] : []))
}

const TASK_STATUS: Record<string, TaskStatus | 'deleted'> = {
  pending: 'pending',
  in_progress: 'in_progress',
  completed: 'completed',
  deleted: 'deleted',
}

/** What a finished task or todo tool call changed, read from its input and result. */
async function trackTasks($: EngineInterface, tool: string, input: unknown, result: unknown): Promise<void> {
  const when = await $.clock.now()
  if (tool === 'TaskCreate' && isRecord(result) && isRecord(result.task)) {
    const { id, subject } = result.task
    if (typeof id === 'string' && typeof subject === 'string') await apply($, { type: 'task_created', id, subject, at: when })
  } else if (tool === 'TaskUpdate' && isRecord(input) && typeof input.taskId === 'string') {
    const event: Extract<SessionEvent, { type: 'task_updated' }> = { type: 'task_updated', id: input.taskId, at: when }
    const status = typeof input.status === 'string' ? TASK_STATUS[input.status] : undefined
    if (status) event.status = status
    if (typeof input.subject === 'string') event.subject = input.subject
    await apply($, event)
  } else if (tool === 'TodoWrite' && isRecord(input) && Array.isArray(input.todos)) {
    const todos = input.todos.flatMap(item => {
      if (!isRecord(item) || typeof item.content !== 'string' || typeof item.status !== 'string') return []
      const status = TASK_STATUS[item.status]
      return status && status !== 'deleted' ? [{ content: item.content, status }] : []
    })
    await apply($, { type: 'todos_written', todos, at: when })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await current($).catch(error => report($, error))
    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await apply($, { type: 'turn_started', at: await $.clock.now() })
    return next(e)
  }).catch(($, e, next) => next(e))

  // A subagent's turns end here too, carrying its `agentId`; they start no turn of their own.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const usage = await $.session.usage()
      const when = await $.clock.now()
      if (usage.cost?.usd !== undefined) await apply($, { type: 'cost_seen', usd: usage.cost.usd, at: when })
      await apply($, { type: 'turn_ended', at: when })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    if (e.agentId !== undefined || id === undefined) return next(e)
    if (e.tool === 'AskUserQuestion') await apply($, { type: 'ask_opened', toolUseId: id, questions: questionsOf(e), at: await $.clock.now() })
    const result = await next(e).finally(() => asked.delete(id))
    if (!('deny' in result)) await trackTasks($, e.tool, e, result.result)
    await apply($, { type: 'tool_finished', toolUseId: id, at: await $.clock.now() })
    return result
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.agentId === undefined && e.tool_use_id !== undefined) {
      asked.set(e.tool_use_id, { tool: e.tool, input: JSON.stringify(e.input) })
    }
    return verdict
  }).catch(($, e, next) => next(e))

  // The prompt carries no tool_use_id: it belongs to the asked call with the same tool and input, or
  // failing that the latest asked call of that tool.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id === undefined) {
      const input = JSON.stringify(e.tool_input)
      const calls = [...asked].filter(([, call]) => call.tool === e.tool_name)
      const [id] = calls.find(([, call]) => call.input === input) ?? calls.at(-1) ?? []
      if (id !== undefined) {
        await apply($, { type: 'permission_asked', toolUseId: id, question: permissionQuestion(e.tool_name, e.tool_input), at: await $.clock.now() })
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every session.end hook shares one 1.5 s budget: one event, one write.
  on('session.end', async ($, e, next) => {
    if (session?.sessionId === e.sessionId) await apply($, { type: 'session_ended', reason: e.reason, at: await $.clock.now() })
    return next(e)
  }).catch(($, e, next) => next(e))
}
