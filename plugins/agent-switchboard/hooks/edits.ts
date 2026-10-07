// The files a session's tools edit, kept beside the snapshot so the board can group a worktree's
// uncommitted changes under the turn that made them (increment 019 in the agent-switchboard
// repository). Pure: the hooks in `register.ts` call these. Edits made through Bash (sed, scripts) are
// not seen; the board shows such files apart.

import { isRecord } from './guards'

/** Edits kept, oldest dropped first. */
export const MAX_EDITS = 500

export type Edit = { at: string; path: string }

/** The argument naming the file each editing tool writes. */
const PATH_ARGUMENT: Record<string, string> = {
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}

/** The file a tool call edits, or nothing for a tool that does not edit one. */
export function editedPathOf(tool: string, args: Record<string, unknown>): string | undefined {
  const key = PATH_ARGUMENT[tool]
  const path = key === undefined ? undefined : args[key]
  return typeof path === 'string' && path !== '' ? path : undefined
}

/** The file with one more edit, oldest first, the last `MAX_EDITS` kept; a broken file starts afresh. */
export function withEdit(existing: string | undefined, edit: Edit): string {
  let edits: unknown = []
  try {
    edits = existing === undefined ? [] : JSON.parse(existing)
  } catch {
    edits = []
  }
  const kept = Array.isArray(edits) ? edits.filter(e => isRecord(e) && typeof e.at === 'string' && typeof e.path === 'string') : []
  return JSON.stringify([...kept, edit].slice(-MAX_EDITS))
}
