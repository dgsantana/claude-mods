// Advisor: the reviewer prompt, its verdict, and what each review costs.

import type { Price } from './layers'

// USD per million tokens (Anthropic first-party list prices, 2026-09-25).
// Cache writes priced at 1.25x input (5-minute TTL). Override in config.
export const DEFAULT_PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

const ALIASES: Record<string, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5',
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function priceFor(model: string, overrides: Record<string, Price>): Price | undefined {
  const id = model.replace(/\[.*\]$/, '').trim()
  const resolved = ALIASES[id] ?? id
  return overrides[id] ?? overrides[resolved] ?? DEFAULT_PRICES[resolved]
}

// The price to charge a review at: the model's own, or, when it has none,
// the most expensive one known, so a budget errs on the safe side.
export function priceOrFallback(model: string, overrides: Record<string, Price>): { price: Price; estimated: boolean } {
  const own = priceFor(model, overrides)
  if (own) return { price: own, estimated: false }
  const all = [...Object.values(DEFAULT_PRICES), ...Object.values(overrides)]
  const top = all.reduce((a, b) => (b.input + b.output > a.input + a.output ? b : a))
  return { price: top, estimated: true }
}

export function costUsd(u: Usage, p: Price): number {
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      u.cache_read_input_tokens * p.cacheRead +
      u.cache_creation_input_tokens * p.cacheWrite) /
    1_000_000
  )
}

export type Verdict = { ok: true } | { ok: false; note: string }

export function parseVerdict(text: string): Verdict {
  const t = text.trim()
  if (t === '' || /^\**ok\**\.?$/i.test(t)) return { ok: true }
  return { ok: false, note: t }
}

export function reviewPrompt(files: readonly string[], answer?: string): string {
  const lines = [
    'You are a reviewer looking over the turn that just finished. It edited these files:',
    ...files.map(f => `- ${f}`),
  ]
  if (answer !== undefined) lines.push('', 'The final answer of that turn:', answer)
  lines.push(
    '',
    'Look for a real problem in those edits: a bug, a broken contract, a missed requirement, an unsafe change.',
    'Reply with exactly OK if there is none. Otherwise reply with one short, actionable note (at most three sentences) and nothing else.',
  )
  return lines.join('\n')
}
