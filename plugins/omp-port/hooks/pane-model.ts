// What the /omp pane shows: each setting's effective value and the layer it
// comes from, and where "this project" writes.

import { getPath } from './config-patch'
import type { Config } from './layers'
import type { ConfigLayer, Layer } from './load'
import { type Setting, settingsFor, type Tab } from './settings-schema'

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
