// The `statusline` section of config.json, sanitised so the status line
// always has a usable layout whatever the files say.

import { getPath } from './config-patch'
import { ICON_SETS, PATH_STYLES, SEGMENT_IDS, SEPARATORS, type SegmentId, settingsFor, validate } from './settings-schema'

export type StatuslineConfig = {
  theme: string
  separator: (typeof SEPARATORS)[number]
  icons: (typeof ICON_SETS)[number]
  left: SegmentId[]
  right: SegmentId[]
  path: { style: (typeof PATH_STYLES)[number] }
  git: { aheadBehind: boolean }
  fiveHour: { showReset: boolean }
  ctx: { warnAt: number; errorAt: number }
}

const PREFIX = 'statusline.'

export function sanitizeStatusline(raw: unknown): { config: StatuslineConfig; warnings: string[] } {
  const warnings: string[] = []
  const isObject = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
  if (raw !== undefined && !isObject) warnings.push('statusline: expected an object; using defaults')
  const out: Record<string, unknown> = {}
  const taken = new Set<string>()

  for (const s of settingsFor('statusline')) {
    const path = s.key.slice(PREFIX.length).split('.')
    let value = isObject ? getPath(raw, path.join('.')) : undefined
    if (s.kind === 'segments' && Array.isArray(value)) {
      const known: readonly unknown[] = SEGMENT_IDS
      const kept: SegmentId[] = []
      for (const id of value) {
        if (!known.includes(id)) warnings.push(`${s.key}: unknown segment ${String(id)} dropped`)
        else if (kept.includes(id as SegmentId)) warnings.push(`${s.key}: duplicate segment ${String(id)} dropped`)
        else if (!taken.has(id as string)) kept.push(id as SegmentId)
      }
      value = kept
    }
    let final = s.default
    if (value !== undefined) {
      const v = validate(s, value)
      if ('error' in v) warnings.push(`${s.key}: ${v.error}; using default`)
      else final = v.value
    }
    if (s.kind === 'segments') {
      const list = (final as SegmentId[]).filter(id => !taken.has(id))
      for (const id of list) taken.add(id)
      final = list
    }
    let node = out
    for (const p of path.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>
    node[path[path.length - 1] ?? s.key] = Array.isArray(final) ? [...final] : final
  }
  return { config: out as StatuslineConfig, warnings }
}
