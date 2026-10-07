// Messages between sessions (Claude Code's SendMessage across sessions on this machine), kept beside
// the snapshot so the board can show them as conversations (increment 015 in the agent-switchboard
// repository). Pure: the hooks in `register.ts` call these.

import { isRecord } from './guards'

/** How many messages, sent and received together, the file keeps. */
export const MAX_MESSAGES = 200

/** Each message's text is capped here, its end kept, as a turn's is. */
export const MAX_MESSAGE_CHARS = 16 * 1024

export type Message = {
  at: string
  direction: 'out' | 'in'
  /** The recipient's name for a sent message; the sender's, from the envelope, for a received one. */
  peer?: string
  text: string
}

/** The engine's envelope around a message from another session, as the model reads it; found anywhere in the text. */
const ENVELOPE = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/
const FROM_NAME = /\bfrom-name="([^"]*)"/
const FROM_ADDRESS = /\bfrom="([^"]*)"/

/**
 * A received delivery's sender and body: the envelope's `from-name`, its `from` address (what a reply is
 * sent to) and its contents, when it has one; else the whole text with no sender.
 */
export function receivedOf(text: string): { peer?: string; address?: string; text: string } {
  const envelope = ENVELOPE.exec(text)
  if (!envelope) return { text: text.trim() }
  const attributes = envelope[1] ?? ''
  const peer = FROM_NAME.exec(attributes)?.[1]
  const address = FROM_ADDRESS.exec(attributes)?.[1]
  return { ...(peer ? { peer } : {}), ...(address ? { address } : {}), text: (envelope[2] ?? '').trim() }
}

/** The file with one more message, oldest first, the last `MAX_MESSAGES` kept; a broken file starts afresh. */
export function withMessage(existing: string | undefined, message: Message): string {
  let messages: unknown = []
  try {
    messages = existing === undefined ? [] : JSON.parse(existing)
  } catch {
    messages = []
  }
  const kept = Array.isArray(messages) ? messages.filter(m => isRecord(m) && typeof m.at === 'string' && typeof m.text === 'string') : []
  const { text } = message
  const capped = text.length <= MAX_MESSAGE_CHARS ? text : `…${text.slice(text.length - MAX_MESSAGE_CHARS + 1)}`
  return JSON.stringify([...kept, { ...message, text: capped }].slice(-MAX_MESSAGES))
}
