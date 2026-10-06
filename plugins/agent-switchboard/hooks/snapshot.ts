// The snapshot file, format version 1, as Agent Switchboard's hub reads it:
// `docs/reference/snapshot-format.md` in the agent-switchboard repository is the contract. Every field
// is bounded, so a file stays small however long the session runs. `tool` marks the file as this mod's;
// the hub reads omp's own files only for snapshots without it.

import { isRecord } from './guards'
import type { SessionState } from './state'

export const SNAPSHOT_FORMAT_VERSION = 1

/** Character limits for free text, including the ellipsis that marks a cut. */
export const LIMITS = { question: 300, todoCurrent: 120, path: 1024, id: 128, lastSaid: 400 } as const

export interface Snapshot {
  formatVersion: typeof SNAPSHOT_FORMAT_VERSION
  tool: 'claude-code'
  sessionId: string
  cwd: string
  agentDir: string
  pid: number
  /** When the session began, when known. */
  startedAt?: string
  state: 'idle' | 'running' | 'waiting'
  lastActivityAt: string
  heartbeatAt: string
  openAsk?: { question: string; count: number; since: string }
  todo?: { closed: number; total: number; current?: string }
  cost: number
  /** The end of the session's latest answer: where its conclusion is. */
  lastSaid?: { text: string; at: string }
  endedAt?: string
  endReason?: string
}

export function toSnapshot(state: SessionState): Snapshot {
  const [oldest] = state.waiting
  const snapshot: Snapshot = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    tool: 'claude-code',
    sessionId: cut(state.sessionId, LIMITS.id),
    cwd: cut(state.cwd, LIMITS.path),
    agentDir: cut(state.agentDir, LIMITS.path),
    pid: state.pid,
    state: oldest ? 'waiting' : state.phase,
    lastActivityAt: iso(state.lastActivityAt),
    heartbeatAt: iso(state.heartbeatAt),
    cost: state.cost,
  }
  if (state.startedAt !== undefined) snapshot.startedAt = iso(state.startedAt)
  if (oldest) snapshot.openAsk = { question: cut(oldest.question, LIMITS.question), count: oldest.count, since: iso(oldest.since) }
  if (state.todo) {
    const todo: NonNullable<Snapshot['todo']> = { closed: state.todo.closed, total: state.todo.total }
    if (state.todo.current !== undefined) todo.current = cut(state.todo.current, LIMITS.todoCurrent)
    snapshot.todo = todo
  }
  if (state.lastSaid) {
    const { text } = state.lastSaid
    const tail = text.length <= LIMITS.lastSaid ? text : `…${text.slice(text.length - LIMITS.lastSaid + 1)}`
    snapshot.lastSaid = { text: tail, at: iso(state.lastSaid.at) }
  }
  if (state.ended) {
    snapshot.endedAt = iso(state.ended.at)
    snapshot.endReason = cut(state.ended.reason, LIMITS.id)
  }
  return snapshot
}

type Env = { SWITCHBOARD_HOME?: string; CLAUDE_CONFIG_DIR?: string; USERPROFILE?: string; HOME?: string }

/** The board's data folder: `SWITCHBOARD_HOME`, else `.agent-switchboard` in the home folder; none without a home. */
export function boardHomeOf(env: Env): string | undefined {
  if (env.SWITCHBOARD_HOME) return env.SWITCHBOARD_HOME
  const home = env.USERPROFILE ?? env.HOME
  return home ? join(home, '.agent-switchboard') : undefined
}

/** Claude Code's configuration folder, reported as the snapshot's `agentDir`; the hub never reads it. */
export function agentDirOf(env: Env): string {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR
  const home = env.USERPROFILE ?? env.HOME
  return home ? join(home, '.claude') : ''
}

/** A session id becomes a file name, so it must not be able to name anything else. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** The full last answer beside the snapshot is capped here, its end kept: the conclusion is there. */
export const MAX_SAID_CHARS = 64 * 1024

/** Where the full last answer goes, for the project page: `said/<sessionId>.md` in the board folder. */
export function saidPathOf(boardHome: string, sessionId: string): string | undefined {
  if (!SAFE_ID.test(sessionId) || sessionId.includes('..')) return undefined
  return join(boardHome, 'said', `${sessionId}.md`)
}

export function saidTextOf(text: string): string {
  return text.length <= MAX_SAID_CHARS ? text : `…${text.slice(text.length - MAX_SAID_CHARS + 1)}`
}

/** How many turn conclusions the history beside the snapshot keeps (increment 011). */
export const MAX_TURNS = 50

/** Where a session's turn history goes: `said/<sessionId>.turns.json` in the board folder. */
export function turnsPathOf(boardHome: string, sessionId: string): string | undefined {
  if (!SAFE_ID.test(sessionId) || sessionId.includes('..')) return undefined
  return join(boardHome, 'said', `${sessionId}.turns.json`)
}

/** The history with one more turn, oldest first, the last `MAX_TURNS` kept; a missing or broken file starts afresh. */
export function withTurn(existing: string | undefined, turn: { at: string; text: string }): string {
  let turns: unknown = []
  try {
    turns = existing === undefined ? [] : JSON.parse(existing)
  } catch {
    turns = []
  }
  const kept = Array.isArray(turns) ? turns.filter(t => isRecord(t) && typeof t.at === 'string' && typeof t.text === 'string') : []
  return JSON.stringify([...kept, turn].slice(-MAX_TURNS))
}

/** The board's settings file, which the hub owns; this mod only reads it. */
export function settingsPathOf(boardHome: string): string {
  return join(boardHome, 'settings.json')
}

export function snapshotPathOf(boardHome: string, sessionId: string): string | undefined {
  if (!SAFE_ID.test(sessionId) || sessionId.includes('..')) return undefined
  return join(boardHome, 'sessions', `${sessionId}.json`)
}

/** Joins with the separator the base already uses, so a Windows home stays a Windows path. */
function join(base: string, ...parts: string[]): string {
  const sep = /^[A-Za-z]:\\/.test(base) || (base.includes('\\') && !base.includes('/')) ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString()
}
