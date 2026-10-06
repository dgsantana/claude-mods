// What this mod takes from the board's `settings.json`: how long a permission check answered `ask`
// stays undecided before it counts as a prompt waiting on the human, and whether the board may queue
// prompts for the session. The hub validates the file with the same rules and defaults; a value the hub
// would refuse is ignored here.

import { isRecord } from './guards'

export const DEFAULT_PROMPT_DELAY_MS = 10_000

/** The `board` section of the settings file, or nothing when the file is missing or broken. */
function boardOf(settingsText: string | undefined): Record<string, unknown> | undefined {
  if (settingsText === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(settingsText)
    return isRecord(parsed) && isRecord(parsed.board) ? parsed.board : undefined
  } catch {
    return undefined
  }
}

export function promptDelayMsOf(settingsText: string | undefined): number {
  const seconds = boardOf(settingsText)?.promptDelaySeconds
  return typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 0 && seconds <= 120 ? seconds * 1000 : DEFAULT_PROMPT_DELAY_MS
}

/** Whether the board may queue prompts for this session (decision 0010): only when exactly on; off by default. */
export function promptingAllowedOf(settingsText: string | undefined): boolean {
  return boardOf(settingsText)?.allowPrompting === true
}
