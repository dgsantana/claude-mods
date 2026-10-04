import { describe, expect, test } from 'bun:test'
import { DEFAULT_PRICES, costUsd, parseVerdict, priceFor, reviewPrompt } from '../hooks/advisor'

describe('costUsd', () => {
  test('per-MTok arithmetic over all four token counts', () => {
    const usd = costUsd(
      { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 2_000_000, cache_creation_input_tokens: 400_000 },
      { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    )
    expect(usd).toBeCloseTo(4 + 2 + 0.4 + 2, 10)
  })
})

describe('priceFor', () => {
  test('exact id, suffixed id and config override', () => {
    expect(priceFor('claude-opus-5-5', {})).toEqual(DEFAULT_PRICES['claude-opus-5-5']!)
    expect(priceFor('claude-opus-5-5[1m]', {})).toEqual(DEFAULT_PRICES['claude-opus-5-5']!)
    const own = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }
    expect(priceFor('claude-opus-5-5', { 'claude-opus-5-5': own })).toEqual(own)
  })
  test('aliases opus/sonnet/haiku/fable resolve', () => {
    expect(priceFor('opus', {})).toEqual(DEFAULT_PRICES['claude-opus-5-5']!)
    expect(priceFor('haiku', {})).toEqual(DEFAULT_PRICES['claude-haiku-4-5']!)
  })
  test('unknown model → undefined', () => {
    expect(priceFor('gpt-x', {})).toBeUndefined()
  })
})

describe('parseVerdict', () => {
  test('OK variants are ok', () => {
    for (const t of ['OK', 'ok.', '  OK\n', '**OK**']) expect(parseVerdict(t)).toEqual({ ok: true })
  })
  test('anything else is a note, trimmed', () => {
    expect(parseVerdict('  The edit drops error handling in foo().  ')).toEqual({ ok: false, note: 'The edit drops error handling in foo().' })
  })
  test('empty reply is ok (nothing to say)', () => {
    expect(parseVerdict('')).toEqual({ ok: true })
  })
})

describe('reviewPrompt', () => {
  test('names edited files and demands OK or a note', () => {
    const p = reviewPrompt(['/a/x.rs', '/a/y.rs'])
    expect(p).toContain('/a/x.rs')
    expect(p).toContain('/a/y.rs')
    expect(p).toContain('OK')
  })
  test('with an answer (no-transcript model) includes it', () => {
    expect(reviewPrompt(['/a'], 'Final answer text')).toContain('Final answer text')
  })
})

import { priceOrFallback } from '../hooks/advisor'

describe('priceOrFallback', () => {
  test('known model: exact price, not estimated', () => {
    expect(priceOrFallback('claude-sonnet-5-5', {})).toEqual({ price: DEFAULT_PRICES['claude-sonnet-5-5']!, estimated: false })
  })
  test('unknown model: most expensive known price, flagged estimated', () => {
    const r = priceOrFallback('claude-sonnet-4-6', {})
    expect(r.estimated).toBe(true)
    expect(r.price).toEqual(DEFAULT_PRICES['claude-fable-5-1']!)
  })
  test('fallback considers config prices too', () => {
    const big = { input: 100, output: 100, cacheRead: 100, cacheWrite: 100 }
    expect(priceOrFallback('mystery', { 'my-model': big }).price).toEqual(big)
  })
})
