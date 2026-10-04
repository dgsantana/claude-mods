// Pure merge of the layers: builtin → global → project chain (nearest last).

import { parseFrontmatter } from './frontmatter'
import type { InterruptMode, Rule } from './rule'

export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Config = {
  rules: { builtin: boolean; disabled: string[] }
  ttsr: {
    enabled: boolean
    interruptMode: InterruptMode
    repeatMode: 'once' | 'after-gap'
    repeatGap: number
  }
  append: { enabled: boolean }
  agentsMd: { enabled: boolean }
  advisor: {
    enabled: boolean
    model?: string
    budgetUsd?: number
    prices: Record<string, Price>
  }
}

export const DEFAULT_CONFIG: Config = {
  rules: { builtin: true, disabled: [] },
  ttsr: { enabled: true, interruptMode: 'always', repeatMode: 'once', repeatGap: 10 },
  append: { enabled: true },
  agentsMd: { enabled: true },
  advisor: { enabled: false, prices: {} },
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function deepMerge(base: unknown, over: unknown): unknown {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v)
  return out
}

export function mergeConfig(layers: readonly unknown[]): Config {
  let out: unknown = DEFAULT_CONFIG
  for (const layer of layers) if (isObject(layer)) out = deepMerge(out, layer)
  return out as Config
}

export function mergeRules(layers: readonly (readonly Rule[])[], config: Config): Rule[] {
  const byName = new Map<string, Rule>()
  for (const layer of layers) for (const r of layer) byName.set(r.name, r)
  const disabled = new Set(config.rules.disabled)
  return [...byName.values()].filter(
    r => r.enabled && !disabled.has(r.name) && (config.rules.builtin || r.source !== 'builtin'),
  )
}

// Each part is one layer's APPEND_SYSTEM.md, low to high.
export function mergeAppend(parts: readonly string[]): string {
  let kept: string[] = []
  for (const part of parts) {
    const { data, body } = parseFrontmatter(part)
    if (data.replace === true) kept = []
    if (body.trim() !== '') kept.push(body.trim())
  }
  return kept.join('\n\n')
}
