// The one hooks module: turns Claude Code's events into Agent Switchboard snapshot files, and offers
// each open prompt to the board, which can answer it as well as the terminal (decision 0009 in the
// agent-switchboard repository). The engine follows `$` only into functions declared in this file, so
// every call on `$` lives here; the rules they feed are in `state.ts`, `snapshot.ts` and `prompt.ts`.
//
// This runs inside the user's session. Every hook passes the event on whatever happens to the
// snapshot, and its `.catch` passes it on when the hook itself fails: a failure here costs the board
// an update, never the session its work.

import type { EngineInterface, Register } from 'claude-code'
import { activityOf } from './activity'
import { BOARD_TOOL_CALLS, BOARD_TOOLS, type BoardToolName, boardListText, boardToolOf, docLinksLine, imageFilesOf, imageProblemOf, tagOutcomeText, withImageHashes } from './board'
import { editedPathOf, type Edit, withEdit } from './edits'
import { isRecord } from './guards'
import { type Message, receivedOf, withMessage } from './messages'
import { type BoardPrompt, callKey, outcomeOf, ownArgs, promptOf, slashCommandOf } from './prompt'
import { promptDelayMsOf, promptingAllowedOf } from './settings'
import { agentDirOf, boardHomeOf, editsPathOf, messagesPathOf, saidPathOf, saidTextOf, settingsPathOf, snapshotPathOf, toSnapshot, turnOf, turnsPathOf, withTurn } from './snapshot'
import { next as advance, permissionQuestion, type SessionEvent, type SessionState, startSession, type TaskStatus } from './state'

const HEARTBEAT_MS = 15_000
const FAILURE_LOG_MS = 60_000

// Module variables reset on a hot reload; the next event or heartbeat starts watching again.
let session: SessionState | undefined
let starting: Promise<SessionState | undefined> | undefined
let heartbeat: { cancel: () => void } | undefined
let writes: Promise<void> = Promise.resolve()
let lastFailureLogAt = Number.NEGATIVE_INFINITY
/** Main-loop calls whose permission check answered `ask` and that have not resolved, by tool_use_id. */
const undecided = new Set<string>()
/** Open calls the board may answer, by tool_use_id: settles with the hub's answer text. */
const boardAnswers = new Map<string, (answerText: string) => void>()
/** Calls offered to the hub, by tool_use_id, so a terminal answer withdraws them there. */
const offered = new Set<string>()
/** Calls the board allowed once, by `callKey`: their re-run's permission check allows them. */
const allowedByBoard = new Set<string>()
/** The hub's per-run token; fetched on first use and again when the hub refuses it. */
let hubToken: string | undefined
/** Senders' names by the `from` address their messages came from, to name a reply sent to that address. */
const peerNames = new Map<string, string>()
/** Whether this session is asking the hub for a prompt written on the board (decision 0010). */
let pickingUp = false
const PLUGIN = 'agent-switchboard'

/** Reported at most once a minute, to the debug log only: never into the conversation. */
async function report($: EngineInterface, error: unknown): Promise<void> {
  const now = await $.clock.now()
  if (now - lastFailureLogAt < FAILURE_LOG_MS) return
  lastFailureLogAt = now
  $.ui.log(`agent-switchboard: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
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
    startedAt: usage.startedAt,
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
  $.clock.after(0, () => {
    pickUpPrompts($).catch(() => {})
  })
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
  const home = await boardHome($)
  const path = home && snapshotPathOf(home, state.sessionId)
  if (!path) throw new Error(`no place for the snapshot of session ${state.sessionId}`)
  const text = JSON.stringify(toSnapshot(state))
  const write = writes.then(() => $.fs.write(path, text))
  writes = write.catch(() => {})
  await write
}

/** The full last answer, beside the snapshot, for the project page; the snapshot keeps only its end. */
async function publishSaid($: EngineInterface, sessionId: string, text: string): Promise<void> {
  const home = await boardHome($)
  const path = home && saidPathOf(home, sessionId)
  if (!path) return
  const write = writes.then(() => $.fs.write(path, saidTextOf(text)))
  writes = write.catch(() => {})
  await write
}

/** Adds a turn's answer to the session's history, for the project page's timeline (increments 011, 014). */
async function appendTurn($: EngineInterface, state: SessionState): Promise<void> {
  const home = await boardHome($)
  const path = home && turnsPathOf(home, state.sessionId)
  const turn = turnOf(state)
  if (!path || !turn) return
  const write = writes.then(async () => {
    let existing: string | undefined
    try {
      const read = await $.fs.read(path)
      existing = typeof read === 'string' ? read : undefined
    } catch {
      existing = undefined
    }
    await $.fs.write(path, withTurn(existing, turn))
  })
  writes = write.catch(() => {})
  await write
}

/** Adds a file a tool edited to the session's record of its edits (increment 019). */
async function recordEdit($: EngineInterface, edit: Edit): Promise<void> {
  const state = await current($)
  const home = await boardHome($)
  const path = state && home && editsPathOf(home, state.sessionId)
  if (!path) return
  const write = writes.then(async () => {
    let existing: string | undefined
    try {
      const read = await $.fs.read(path)
      existing = typeof read === 'string' ? read : undefined
    } catch {
      existing = undefined
    }
    await $.fs.write(path, withEdit(existing, edit))
  })
  writes = write.catch(() => {})
  await write
}

/** Adds a message to the session's record of its messages with other sessions (increment 015). */
async function recordMessage($: EngineInterface, message: Message): Promise<void> {
  const state = await current($)
  const home = await boardHome($)
  const path = state && home && messagesPathOf(home, state.sessionId)
  if (!path) return
  const write = writes.then(async () => {
    let existing: string | undefined
    try {
      const read = await $.fs.read(path)
      existing = typeof read === 'string' ? read : undefined
    } catch {
      existing = undefined
    }
    await $.fs.write(path, withMessage(existing, message))
  })
  writes = write.catch(() => {})
  await write
}

async function boardHome($: EngineInterface): Promise<string | undefined> {
  return boardHomeOf({
    SWITCHBOARD_HOME: await $.env.get('SWITCHBOARD_HOME'),
    USERPROFILE: await $.env.get('USERPROFILE'),
    HOME: await $.env.get('HOME'),
  })
}

/**
 * How long a call whose permission check answered `ask` stays undecided before it counts as a prompt
 * on screen: `board.promptDelaySeconds` in the board's settings, read on each `ask` so a change applies
 * at once. `ask` hands the call to the mode's decider, a prompt or in auto mode a classifier, which
 * took from 1 to 10.6 s when measured (2026-10-06); no hook or call tells the two apart.
 */
async function promptDelayMs($: EngineInterface): Promise<number> {
  return promptDelayMsOf(await settingsText($))
}

/** The board's settings file as text, or nothing when it cannot be read. */
async function settingsText($: EngineInterface): Promise<string | undefined> {
  const home = await boardHome($)
  if (!home) return undefined
  try {
    const text = await $.fs.read(settingsPathOf(home))
    return typeof text === 'string' ? text : undefined
  } catch {
    return undefined
  }
}

/**
 * While the session is idle and the board may prompt it, asks the hub for the next prompt written on the
 * board, in rounds under 30 s, and submits it: as the person's words when the person wrote it, framed as
 * this plugin's message otherwise. Stops when a turn starts (the next
 * `turn.complete` starts it again), when prompting is off, or on any failure; the heartbeat retries.
 */
async function pickUpPrompts($: EngineInterface): Promise<void> {
  if (pickingUp) return
  pickingUp = true
  try {
    while (session && !session.ended && session.phase === 'idle' && session.waiting.length === 0) {
      if (!promptingAllowedOf(await settingsText($))) return
      const asked = await $.clock.now()
      const response = await hubSend($, 'GET', `/api/sessions/${encodeURIComponent(session.sessionId)}/prompts/next`)
      if (response.status === 204) {
        // The hub holds a round for 25 s; an empty answer at once means it sees the session busy.
        if ((await $.clock.now()) - asked < 1000) await $.clock.sleep(2000)
        continue
      }
      if (response.status !== 200) return
      const parsed: unknown = JSON.parse(response.text)
      if (!isRecord(parsed) || typeof parsed.text !== 'string') return
      // Only the person's own prompt is their words, and only it may run a slash command (decision
      // 0015). Another session's, or one that does not say, keeps the plugin's frame for the model.
      const byPerson = parsed.from === 'person'
      // One of the session's slash commands runs as that command, as it would typed in the terminal;
      // `$.prompt.submit` would hand it to the model as words (2026-10-07).
      const command = byPerson ? slashCommandOf(parsed.text, (await $.command.list()).map(c => c.name)) : undefined
      if (command) await $.command.run(command)
      // Held by Claude Code until the session is idle, should a turn have started meanwhile.
      else if (byPerson) await $.prompt.submit({ text: parsed.text, asUser: true })
      // The engine refuses a plugin prompt that begins with `/`; quoting it keeps it words.
      else await $.prompt.submit({ text: parsed.text.trimStart().startsWith('/') ? `> ${parsed.text}` : parsed.text })
      return
    }
  } catch (error) {
    await report($, error)
  } finally {
    pickingUp = false
  }
}

async function hubUrl($: EngineInterface, path: string): Promise<string> {
  return `http://127.0.0.1:${(await $.env.get('SWITCHBOARD_PORT')) ?? '4777'}${path}`
}

/** A request to the hub that changes something: it carries the token, fetched again once if refused. */
async function hubWrite($: EngineInterface, method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<number> {
  return (await hubSend($, method, path, body)).status
}

/**
 * Any request to the hub but the token's own, with its answer: every one carries the token, since reads
 * take queued state or make the hub look at a path (omp-board review 2026-10-08, H3 and H4).
 */
async function hubSend($: EngineInterface, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; text: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (hubToken === undefined || attempt > 0) {
      const answer = await $.http.fetch(await hubUrl($, '/api/token'))
      const parsed: unknown = JSON.parse(answer.text)
      hubToken = isRecord(parsed) && typeof parsed.token === 'string' ? parsed.token : undefined
    }
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method,
      headers: { 'content-type': 'application/json', 'x-hub-token': hubToken ?? '' },
    }
    if (body !== undefined) init.body = JSON.stringify(body)
    const response = await $.http.fetch(await hubUrl($, path), init)
    if (response.status !== 403) return { status: response.status, text: response.text }
  }
  return { status: 403, text: 'the hub refused this session its token' }
}

/**
 * Runs one whiteboard tool against the hub (decision 0014): the board named, else this session's project
 * board; writes carry this session as their author. A failure is returned as text the model can act on.
 */
async function runBoardTool($: EngineInterface, tool: BoardToolName, args: Record<string, unknown>): Promise<string> {
  if (tool === 'board_list') {
    const list = await hubSend($, 'GET', '/api/boards')
    return list.status === 200 ? boardListText(list.text) : `Could not list the boards: ${list.status} ${list.text}`
  }
  const state = await current($)
  const author = { kind: 'session', sessionId: state?.sessionId ?? 'unknown', tool: 'claude-code' }
  if (tool === 'board_create') {
    const created = await hubSend($, 'POST', '/api/boards', { title: args.title, author })
    if (created.status !== 200) return `Not created: ${created.status} ${created.text}`
    const parsed: unknown = JSON.parse(created.text)
    return isRecord(parsed) && typeof parsed.id === 'string' ? `Created board ${parsed.id}, "${String(parsed.title ?? args.title)}".` : 'The hub did not name the new board.'
  }
  // This session's project board, and the project the hub knows its folder by (the main worktree).
  const found = await hubSend($, 'GET', `/api/board-for?cwd=${encodeURIComponent(await $.session.cwd())}`)
  const own: unknown = found.status === 200 ? JSON.parse(found.text) : undefined
  const ownProject = isRecord(own) && typeof own.project === 'string' ? own.project : undefined
  let board = typeof args.board === 'string' && args.board !== '' ? args.board : undefined
  if (!board) {
    if (found.status !== 200) return `No board for this folder: ${found.text}. Name one from board_list.`
    if (!isRecord(own) || typeof own.id !== 'string') return 'The hub did not name a board for this folder.'
    board = own.id
  }
  // The project goes with reads and writes of its own board only, as before; doc links are this project's on any board.
  const project = isRecord(own) && board === own.id ? ownProject : undefined
  const where = `/api/boards/${encodeURIComponent(board)}`
  const outline = `${where}/outline${project ? `?project=${encodeURIComponent(project)}` : ''}`
  if (tool === 'board_read') return `${await readBoard($, board, outline)}${ownProject ? `\n\n${docLinksLine(ownProject)}` : ''}`
  // Images go to the hub's store first; the ops then name each by its hash, never by a local path.
  const hashes: Record<string, string> = {}
  for (const file of tool === 'board_write' ? imageFilesOf(args.ops) : []) {
    const named = imageProblemOf(file, 0)
    if (named) return `Not applied: ${named}.`
    const read = await $.fs.read(file, { as: 'bytes' })
    const base64 = typeof read === 'string' ? '' : read.base64
    const tooBig = imageProblemOf(file, Math.floor((base64.length * 3) / 4) - (base64.match(/=+$/)?.[0].length ?? 0))
    if (tooBig) return `Not applied: ${tooBig}.`
    const stored = await hubSend($, 'POST', '/api/images', { base64 })
    const parsed: unknown = stored.status === 200 ? JSON.parse(stored.text) : undefined
    if (!isRecord(parsed) || typeof parsed.hash !== 'string') return `Not applied: the image ${file} was not stored: ${stored.status} ${stored.text}`
    hashes[file] = parsed.hash
  }
  const ops = tool === 'board_comment' ? [{ op: 'comment', id: args.block, text: args.text }] : withImageHashes(args.ops, hashes)
  const notify = tool === 'board_comment' && Array.isArray(args.notify) ? args.notify : undefined
  const answer = await hubSend($, 'POST', `${where}/ops`, { ops, author, ...(project ? { project } : {}), ...(notify?.length ? { notify } : {}) })
  if (answer.status !== 200) return `Not applied: ${answer.text}`
  if (tool === 'board_comment') return `Commented.${tagOutcomeText(answer.text)}`
  return `Applied. The board now:\n\n${await readBoard($, board, outline)}`
}

/** A board as text; a failed read says so, rather than handing an error page to the model as the board. */
async function readBoard($: EngineInterface, board: string, outlinePath: string): Promise<string> {
  const read = await hubSend($, 'GET', outlinePath)
  return read.status === 200 ? read.text : `Could not read board ${board}: ${read.status} ${read.text}`
}

/**
 * Offers a prompt to the board and waits for its answer in rounds (the hub holds each for 25 s, under
 * the 30 s `$.http.fetch` allows), until the board answers or the call resolves. Any failure ends the
 * offer: the terminal answers as if the board did not exist.
 */
async function offerToBoard($: EngineInterface, prompt: BoardPrompt): Promise<void> {
  const id = prompt.id
  try {
    if ((await hubWrite($, 'POST', '/api/prompts', prompt)) !== 204) return
    offered.add(id)
    while (boardAnswers.has(id)) {
      const response = await hubSend($, 'GET', `/api/prompts/${encodeURIComponent(id)}/answer`)
      if (response.status === 200) {
        boardAnswers.get(id)?.(response.text)
        return
      }
      // The hub restarted and lost the prompt: offer it again while the call is still open.
      if (response.status === 404 && boardAnswers.has(id) && (await hubWrite($, 'POST', '/api/prompts', prompt)) !== 204) return
      if (response.status !== 204 && response.status !== 404) return
    }
  } catch (error) {
    await report($, error)
  }
}

async function withdrawFromBoard($: EngineInterface, id: string): Promise<void> {
  if (!offered.delete(id)) return
  try {
    await hubWrite($, 'DELETE', `/api/prompts/${encodeURIComponent(id)}`)
  } catch (error) {
    await report($, error)
  }
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
    // The whiteboard tools (decision 0014); session.start fires again on a reload, which registers them anew.
    for (const tool of BOARD_TOOLS) await $.tool.register({ ...tool, inputSchema: { ...tool.inputSchema } }).catch(error => report($, error))
    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: BOARD_TOOL_CALLS }, async ($, e, next) => {
    const tool = boardToolOf(e.tool)
    if (!tool) return next(e)
    // Answered here without `next`, so the main-loop hook below never sees it: note the activity here.
    if (e.agentId === undefined) await apply($, { type: 'tool_started', activity: activityOf(e.tool, ownArgs(e)), at: await $.clock.now() })
    try {
      return { result: await runBoardTool($, tool, ownArgs(e)) }
    } catch (error) {
      return { deny: `The board could not be reached: ${error instanceof Error ? error.message : String(error)}` }
    }
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
      await apply($, { type: 'turn_ended', said: e.answer, at: when })
      if (session && e.answer.trim() !== '') {
        await publishSaid($, session.sessionId, e.answer.trim()).catch(error => report($, error))
        await appendTurn($, session).catch(error => report($, error))
      }
      $.clock.after(0, () => {
        pickUpPrompts($).catch(() => {})
      })
    }
    return result
  }).catch(($, e, next) => next(e))

  // The files the session's tools edit, a subagent's included, for the board to group changes by the
  // turn that made them (increment 019): recorded once the call succeeded, never changed. Matched by tool,
  // since the engine allows one unmatched hook per event (the board's prompt race below).
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const result = await next(e)
    try {
      const path = editedPathOf(e.tool, ownArgs(e))
      const failed = 'deny' in result || ('isError' in result && result.isError === true)
      if (path && !failed) await recordEdit($, { at: new Date(await $.clock.now()).toISOString(), path })
    } catch (error) {
      await report($, error).catch(() => {})
    }
    return result
  }).catch(($, e, next) => next(e))

  // The terminal and the board race for an open prompt: whichever answers first gives the call its
  // result. Without an offer to the board this is the terminal's `next(e)` as before.
  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    if (e.agentId !== undefined || id === undefined) return next(e)
    await apply($, { type: 'tool_started', activity: activityOf(e.tool, ownArgs(e)), at: await $.clock.now() })
    if (e.tool === 'AskUserQuestion') await apply($, { type: 'ask_opened', toolUseId: id, questions: questionsOf(e), at: await $.clock.now() })
    let settle: (answerText: string) => void = () => {}
    const fromBoard = new Promise<string>(resolve => {
      settle = resolve
    })
    boardAnswers.set(id, settle)
    const terminal = next(e).then(result => ({ result }))
    const first = await Promise.race([terminal, fromBoard.then(text => ({ text }))])
    boardAnswers.delete(id)
    undecided.delete(id)
    let result = 'result' in first ? first.result : undefined
    if ('text' in first) {
      const outcome = outcomeOf(first.text, e.tool, e)
      if (outcome === undefined) result = (await terminal).result
      else if ('deny' in outcome) result = { deny: outcome.deny }
      else if ('result' in outcome) result = { result: outcome.result } as never
      else {
        // Allowed once on the board: the same call again, as this plugin's own, which its permission
        // check allows unless a rule denies it outright.
        const key = callKey(e.tool, e)
        allowedByBoard.add(key)
        try {
          result = (await $.tool.call({ ...ownArgs(e), tool: e.tool, consent: 'The user pressed "Allow once" for this call on Agent Switchboard' } as never)) as never
        } finally {
          allowedByBoard.delete(key)
        }
      }
    } else {
      $.clock.after(0, () => {
        withdrawFromBoard($, id).catch(() => {})
      })
    }
    if (result === undefined) result = (await terminal).result
    if (!('deny' in result)) await trackTasks($, e.tool, e, result.result)
    await apply($, { type: 'tool_finished', toolUseId: id, at: await $.clock.now() })
    return result
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    // This plugin's own re-run of a call the board allowed once: allowed where the rules would ask.
    if (next.origin.plugin === PLUGIN) {
      const allowed = verdict.decision === 'ask' && allowedByBoard.has(callKey(e.tool, e.input))
      return allowed ? { ...verdict, decision: 'allow', reason: 'Allowed once on Agent Switchboard' } : verdict
    }
    if (verdict.decision === 'ask' && e.agentId === undefined && id !== undefined) {
      undecided.add(id)
      const question = permissionQuestion(e.tool, e.input)
      const since = await $.clock.now()
      const sessionId = session?.sessionId
      if (sessionId !== undefined && boardAnswers.has(id)) {
        const prompt = promptOf(sessionId, id, e.tool, e.input, since)
        $.clock.after(0, () => {
          offerToBoard($, prompt).catch(() => {})
        })
      }
      $.clock.after(await promptDelayMs($), () => {
        if (!undecided.has(id)) return
        $.clock
          .now()
          .then(at => apply($, { type: 'permission_asked', toolUseId: id, question, since, at }))
          .catch(error => report($, error))
      })
    }
    return verdict
  }).catch(($, e, next) => next(e))

  // The "run in background" pill is drawn about 2 s into an allowed Bash command: the call is decided,
  // so a long command does not read as waiting until it ends. Drawing is not held up by the write.
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    const id = e.props.tool_use_id
    if (undecided.delete(id)) {
      $.clock.after(0, () => {
        $.clock
          .now()
          .then(at => apply($, { type: 'permission_decided', toolUseId: id, at }))
          .catch(error => report($, error))
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Messages between sessions, for the board's conversations (increment 015): recorded once the engine
  // has handled them, never changed, and nothing after `next` may throw. A subagent's messages, and
  // deliveries from anything but another session, are left out.
  on('session.send', async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.agentId === undefined && result.isDelivered) {
        // A reply addressed to a received `from` address is named by that message's `from-name`.
        const peer = peerNames.get(e.to) ?? e.to
        await recordMessage($, { at: new Date(await $.clock.now()).toISOString(), direction: 'out', peer, text: e.text.trim() })
      }
    } catch (error) {
      await report($, error).catch(() => {})
    }
    return result
  }).catch(($, e, next) => next(e))

  on('session.receive', async ($, e, next) => {
    const result = await next(e)
    try {
      const fromSession = (e.origin.kind === 'peer' || e.origin.kind === 'peer-send-message') && !('teammate' in e.origin)
      if (e.agentId === undefined && fromSession && result.consumed === undefined) {
        const { address, ...received } = receivedOf(e.text)
        if (address && received.peer) peerNames.set(address, received.peer)
        await recordMessage($, { at: new Date(await $.clock.now()).toISOString(), direction: 'in', ...received })
      }
    } catch (error) {
      await report($, error).catch(() => {})
    }
    return result
  }).catch(($, e, next) => next(e))

  // Every session.end hook shares one 1.5 s budget: one event, one write.

  on('session.end', async ($, e, next) => {
    if (session?.sessionId === e.sessionId) await apply($, { type: 'session_ended', reason: e.reason, at: await $.clock.now() })
    return next(e)
  }).catch(($, e, next) => next(e))
}
