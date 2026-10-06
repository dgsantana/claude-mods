// The one value this mod takes from the board's `settings.json`: how long a permission check answered
// `ask` stays undecided before it counts as a prompt waiting on the human. The hub validates the file
// with the same range (0 to 120 whole seconds) and default; a value the hub would refuse is ignored here.

import { isRecord } from './guards'

export const DEFAULT_PROMPT_DELAY_MS = 10_000

export function promptDelayMsOf(settingsText: string | undefined): number {
  if (settingsText === undefined) return DEFAULT_PROMPT_DELAY_MS
  let parsed: unknown
  try {
    parsed = JSON.parse(settingsText)
  } catch {
    return DEFAULT_PROMPT_DELAY_MS
  }
  const seconds = isRecord(parsed) && isRecord(parsed.board) ? parsed.board.promptDelaySeconds : undefined
  return typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 0 && seconds <= 120 ? seconds * 1000 : DEFAULT_PROMPT_DELAY_MS
}
