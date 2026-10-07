import { describe, expect, test } from 'bun:test'
import { MAX_MESSAGE_CHARS, MAX_MESSAGES, receivedOf, withMessage } from '../hooks/messages'
import { messagesPathOf } from '../hooks/snapshot'

describe('messages between sessions, beside the snapshot (increment 015)', () => {
  test('go to said/<session>.messages.json, only for a safe id', () => {
    expect(messagesPathOf('/home/u/.agent-switchboard', 'abc-1')).toBe('/home/u/.agent-switchboard/said/abc-1.messages.json')
    expect(messagesPathOf('/b', '../x')).toBeUndefined()
  })

  test('a received message in the engine envelope gives its sender and its body', () => {
    const text = '<cross-session-message from="uds:\\\\.\\pipe\\LOCAL\\cc-msg-1" from-name="claude-mods-a6" from-mode="prompting">\nThe fix is pushed.\n</cross-session-message>'
    expect(receivedOf(text)).toEqual({ peer: 'claude-mods-a6', address: 'uds:\\\\.\\pipe\\LOCAL\\cc-msg-1', text: 'The fix is pushed.' })
  })

  test('an envelope with text around it is still found', () => {
    expect(receivedOf('Note before.\n<cross-session-message from-name="vade-server-37">Ack.</cross-session-message>\nA note after.')).toEqual({
      peer: 'vade-server-37',
      text: 'Ack.',
    })
  })

  test('a received message without an envelope is kept whole, with no sender', () => {
    expect(receivedOf('  plain words  ')).toEqual({ text: 'plain words' })
  })

  test('appends oldest first, keeping the last 200, each text capped with its end kept', () => {
    let file: string | undefined
    for (let i = 1; i <= MAX_MESSAGES + 2; i++) file = withMessage(file, { at: 'x', direction: 'out', peer: 'p', text: `m${i}` })
    const kept = JSON.parse(file ?? '[]') as Array<{ text: string }>
    expect(kept).toHaveLength(MAX_MESSAGES)
    expect(kept[0]?.text).toBe('m3')
    const long = JSON.parse(withMessage(undefined, { at: 'x', direction: 'in', text: `${'a'.repeat(MAX_MESSAGE_CHARS)}END` })) as Array<{ text: string }>
    expect(long[0]?.text).toHaveLength(MAX_MESSAGE_CHARS)
    expect(long[0]?.text.startsWith('…')).toBe(true)
    expect(long[0]?.text.endsWith('END')).toBe(true)
  })

  test('a missing or broken file starts afresh; a received message without a sender has no peer key', () => {
    expect(JSON.parse(withMessage('{ broken', { at: 'x', direction: 'in', text: 'hi' }))).toEqual([{ at: 'x', direction: 'in', text: 'hi' }])
  })
})
