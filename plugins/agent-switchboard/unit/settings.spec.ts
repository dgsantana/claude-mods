import { describe, expect, test } from 'bun:test'
import { DEFAULT_PROMPT_DELAY_MS, promptDelayMsOf } from '../hooks/settings'

describe("the prompt delay, from the board's settings.json", () => {
  test('is board.promptDelaySeconds in milliseconds', () => {
    expect(promptDelayMsOf('{"board":{"promptDelaySeconds":5}}')).toBe(5_000)
    expect(promptDelayMsOf('{"board":{"promptDelaySeconds":0}}')).toBe(0)
  })

  test('is the default of 10 s when the file is missing, broken, or the value is not one the hub accepts', () => {
    expect(DEFAULT_PROMPT_DELAY_MS).toBe(10_000)
    expect(promptDelayMsOf(undefined)).toBe(10_000)
    expect(promptDelayMsOf('{ not json')).toBe(10_000)
    expect(promptDelayMsOf('{"board":{}}')).toBe(10_000)
    expect(promptDelayMsOf('{"board":{"promptDelaySeconds":"5"}}')).toBe(10_000)
    expect(promptDelayMsOf('{"board":{"promptDelaySeconds":121}}')).toBe(10_000)
    expect(promptDelayMsOf('{"board":{"promptDelaySeconds":2.5}}')).toBe(10_000)
  })
})
