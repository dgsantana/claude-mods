import { describe, expect, test } from 'bun:test'
import { mergeConfig } from '../hooks/layers'
import type { ConfigLayer, Layer } from '../hooks/load'
import { paneRows, parseListInput, projectLayerDir } from '../hooks/pane-model'

const layers: ConfigLayer[] = [
  { source: 'global', dir: '/h/.agents', value: { statusline: { theme: 'g', separator: 'pipe' } } },
  { source: 'project', dir: '/r/.agents', value: { statusline: { theme: 'p' } } },
]
const snap = { config: mergeConfig(layers.map(l => l.value)), configLayers: layers }
const row = (tab: Parameters<typeof paneRows>[0], key: string, store: Record<string, unknown> = {}) =>
  paneRows(tab, snap, store).find(r => r.setting.key === key)

describe('paneRows', () => {
  test('value and origin from the highest layer that sets the key', () => {
    expect(row('statusline', 'statusline.theme')).toMatchObject({ value: 'p', origin: 'project' })
    expect(row('statusline', 'statusline.separator')).toMatchObject({ value: 'pipe', origin: 'global' })
    expect(row('statusline', 'statusline.icons')).toMatchObject({ value: 'nerd', origin: 'default' })
  })
  test('store-backed settings read the store first', () => {
    expect(row('advisor', 'advisor.enabled', { 'advisor.enabled': true })).toMatchObject({ value: true, origin: 'store' })
    expect(row('advisor', 'advisor.enabled')).toMatchObject({ value: false, origin: 'default' })
    expect(row('advisor', 'advisor.budgetUsd')).toMatchObject({ value: undefined, origin: 'default' })
  })
  test('rows follow the catalogue order for the tab', () => {
    expect(paneRows('ttsr', snap, {}).map(r => r.setting.key)).toEqual(['ttsr.enabled', 'ttsr.interruptMode', 'ttsr.repeatMode', 'ttsr.repeatGap'])
  })
})

describe('projectLayerDir', () => {
  const L: Layer[] = [
    { source: 'builtin', dir: '/p/builtin-rules' },
    { source: 'global', dir: '/h/.agents' },
    { source: 'project', dir: '/r/.agents' },
    { source: 'project', dir: '/r/sub/.agents' },
  ]
  test('repo root project layer when in a repo', () => {
    expect(projectLayerDir(L, true)).toBe('/r/.agents')
  })
  test('undefined outside a repo or with no project layer (cwd is home)', () => {
    expect(projectLayerDir(L, false)).toBeUndefined()
    expect(projectLayerDir(L.slice(0, 2), true)).toBeUndefined()
  })
})

describe('parseListInput', () => {
  test('commas and spaces, trimmed, empty dropped', () => {
    expect(parseListInput(' model, git  pr,,')).toEqual(['model', 'git', 'pr'])
    expect(parseListInput('')).toEqual([])
  })
})
