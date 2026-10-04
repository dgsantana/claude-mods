// What the /omp pane shows: each setting's effective value and the layer it
// comes from, and where "this project" writes.

import { getPath } from './config-patch'
import type { Config } from './layers'
import type { ConfigLayer, Layer } from './load'
import type { Rule } from './rule'
import { type SegmentId, type Setting, settingsFor, type Tab } from './settings-schema'
import type { StatuslineConfig } from './statusline-config'
import { type ResolvedTheme, type ThemeToken, toHex } from './themes'

export type Origin = 'default' | 'global' | 'project' | 'store'
export type PaneRow = { setting: Setting; value: unknown; origin: Origin }

export function paneRows(
  tab: Tab,
  snap: { config: Config; configLayers: readonly ConfigLayer[] },
  store: Record<string, unknown>,
): PaneRow[] {
  return settingsFor(tab).map(setting => {
    if (setting.storage === 'store' && store[setting.key] !== undefined) {
      return { setting, value: store[setting.key], origin: 'store' }
    }
    const from = [...snap.configLayers].reverse().find(l => getPath(l.value, setting.key) !== undefined)
    if (from && from.source !== 'builtin') return { setting, value: getPath(from.value, setting.key), origin: from.source }
    const merged = getPath(snap.config, setting.key)
    return { setting, value: merged !== undefined ? merged : setting.default, origin: 'default' }
  })
}

// "This project" is the repository root's .agents; none outside a repository.
export function projectLayerDir(layers: readonly Layer[], inRepo: boolean): string | undefined {
  return inRepo ? layers.find(l => l.source === 'project')?.dir : undefined
}

export function parseListInput(text: string): string[] {
  return text.split(/[\s,]+/).map(s => s.trim()).filter(s => s !== '')
}

export type SegmentOp = { up: SegmentId } | { down: SegmentId } | { remove: SegmentId } | { add: SegmentId }

export function segmentsEdit(list: readonly SegmentId[], op: SegmentOp): SegmentId[] {
  const out = [...list]
  if ('add' in op) return out.includes(op.add) ? out : [...out, op.add]
  if ('remove' in op) return out.filter(id => id !== op.remove)
  const id = 'up' in op ? op.up : op.down
  const i = out.indexOf(id)
  const j = 'up' in op ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= out.length) return out
  ;[out[i], out[j]] = [out[j] as SegmentId, out[i] as SegmentId]
  return out
}

export type RuleRow = { name: string; source: Rule['source']; kind: 'always' | 'rulebook' | 'ttsr' | 'inactive'; disabled: boolean }

export function rulesRows(rules: readonly Rule[], cfg: Config['rules']): RuleRow[] {
  return [...rules]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(r => ({
      name: r.name,
      source: r.source,
      kind: r.condition?.length || r.astCondition?.length ? 'ttsr' : r.alwaysApply ? 'always' : r.description ? 'rulebook' : 'inactive',
      disabled: cfg.disabled.includes(r.name) || (!cfg.builtin && r.source === 'builtin'),
    }))
}

const SAMPLE: Record<SegmentId, string> = {
  model: 'Opus', caveman: 'ULTRA', mode: 'NORMAL', path: 'project', git: 'main*', pr: '#42',
  session: 'session', tokens: '12.8k', cost: '$0.42', fiveHour: '77% left', ctx: '31%',
}

export const SEGMENT_TOKEN: Record<SegmentId, ThemeToken> = {
  model: 'statusLineModel', caveman: 'statusLineCaveman', mode: 'accent', path: 'statusLinePath', git: 'statusLineGitDirty',
  pr: 'accent', session: 'dim', tokens: 'statusLineOutput', cost: 'statusLineCost', fiveHour: 'success', ctx: 'statusLineContext',
}

export type PreviewSegment = { id: SegmentId; text: string; colour: string }

export function previewSegments(config: StatuslineConfig, theme: ResolvedTheme): PreviewSegment[] {
  return [...config.left, ...config.right].map(id => ({ id, text: SAMPLE[id], colour: toHex(theme[SEGMENT_TOKEN[id]]) }))
}
