// What the /dgs pane shows: each setting's effective value and the layer it
// comes from, and where "this project" writes.

import { getPath } from './config-patch'
import type { Config } from './layers'
import type { ConfigLayer, Layer } from './load'
import type { Rule } from './rule'
import { SEGMENT_IDS, type SegmentId, type Setting, SETTINGS, settingsFor, type Tab } from './settings-schema'
import type { StatusData } from './status'

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

// The segment table: every segment once, the shown ones first (the left side
// in order, then the right), then the hidden ones in catalogue order.
export type SegmentLists = { left: SegmentId[]; right: SegmentId[] }
export type SegmentRow = { id: SegmentId; side: 'L' | 'R' | null }

export function segmentRows(lists: SegmentLists): SegmentRow[] {
  const shown = new Set([...lists.left, ...lists.right])
  return [
    ...lists.left.map(id => ({ id, side: 'L' as const })),
    ...lists.right.map(id => ({ id, side: 'R' as const })),
    ...SEGMENT_IDS.filter(id => !shown.has(id)).map(id => ({ id, side: null })),
  ]
}

// On: off removes it from its side; a hidden segment joins the right side.
export function segmentToggle(lists: SegmentLists, id: SegmentId): SegmentLists {
  if (lists.left.includes(id) || lists.right.includes(id)) {
    return { left: lists.left.filter(s => s !== id), right: lists.right.filter(s => s !== id) }
  }
  return { left: [...lists.left], right: [...lists.right, id] }
}

export function segmentSide(lists: SegmentLists, id: SegmentId): SegmentLists {
  if (lists.left.includes(id)) return { left: lists.left.filter(s => s !== id), right: [...lists.right, id] }
  if (lists.right.includes(id)) return { left: [...lists.left, id], right: lists.right.filter(s => s !== id) }
  return { left: [...lists.left], right: [...lists.right] }
}

export function segmentMove(lists: SegmentLists, id: SegmentId, dir: 'up' | 'down'): SegmentLists {
  const op = dir === 'up' ? { up: id } : { down: id }
  return { left: segmentsEdit(lists.left, op), right: segmentsEdit(lists.right, op) }
}

export type PaneGroup = { title?: string; settings: Setting[] }

// A tab's settings by heading, in catalogue order; segment lists are drawn as
// the table instead.
export function paneGroups(settings: readonly Setting[]): PaneGroup[] {
  const out: PaneGroup[] = []
  for (const setting of settings) {
    if (setting.kind === 'segments') continue
    const last = out[out.length - 1]
    if (last && last.title === setting.group) last.settings.push(setting)
    else out.push({ title: setting.group, settings: [setting] })
  }
  return out
}

export function labelWidth(settings: readonly Setting[]): number {
  return Math.max(0, ...settings.map(s => s.label.length)) + 1
}

const SEGMENT_HINTS: Record<string, string> = {
  'seg-on-': 'Turn this segment on or off; one turned on joins the right side.',
  'seg-side-': 'Move this segment to the end of the other side.',
  'seg-up-': 'Change its order within its side.',
  'seg-down-': 'Change its order within its side.',
}

// The hint line under the pane: what the control holding the focus does.
export function hintFor(element: string | undefined): string | undefined {
  if (!element) return undefined
  if (element === 'reset-segments') return 'Back to the default segments and order.'
  const seg = Object.keys(SEGMENT_HINTS).find(p => element.startsWith(p))
  if (seg) return SEGMENT_HINTS[seg]
  const setting = SETTINGS.find(
    s => element === `set-${s.key}` || element === `set-${s.key}-group` || element === `reset-${s.key}`,
  )
  return setting?.description
}

// Sample readings for the pane's preview, one for every segment.
export const PREVIEW_DATA: StatusData = {
  model: 'claude-opus-5-5[1m]',
  cwd: '/home/u/project',
  home: '/home/u',
  git: { branch: 'main', dirty: true, ahead: 1, behind: 0, sha: '01a0fde', staged: 2, unstaged: 1, untracked: 3 },
  caveman: { mode: 'ULTRA' },
  tokens: 128_400,
  percent: 43,
  window: 1_000_000,
  usd: 0.42,
  fiveHour: { percentUsed: 23 },
  sevenDay: { percentUsed: 18 },
  startedAt: 0,
  lastTurn: { usd: 0.12, tokens: 9_800 },
  activity: { ttsrHits: 1 },
  now: 26 * 60_000,
}

// Engine Selects take at most this many options.
export const SELECT_MAX = 64

export type ThemeGroup = { label: string; names: string[] }

// Themes split into families (dark, light, other) for a two-step picker; a
// family larger than a Select allows is paged.
export function themeGroups(names: readonly string[]): ThemeGroup[] {
  const family = (n: string) => (n === 'dark' || n.startsWith('dark-') ? 'dark' : n === 'light' || n.startsWith('light-') ? 'light' : 'other')
  const out: ThemeGroup[] = []
  for (const label of ['dark', 'light', 'other']) {
    const list = [...names].filter(n => family(n) === label).sort()
    if (list.length === 0) continue
    const pages = Math.ceil(list.length / SELECT_MAX)
    for (let p = 0; p < pages; p++) {
      out.push({ label: pages > 1 ? `${label} ${p + 1}/${pages}` : label, names: list.slice(p * SELECT_MAX, (p + 1) * SELECT_MAX) })
    }
  }
  return out
}
