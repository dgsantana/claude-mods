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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { previewSegments, rulesRows, segmentsEdit } from '../hooks/pane-model'
import type { Rule } from '../hooks/rule'
import { schemaDefaults } from '../hooks/settings-schema'
import { resolveTheme, toHex } from '../hooks/themes'

describe('segmentsEdit', () => {
  const L = ['model', 'path', 'git'] as const
  test('up / down / remove / add', () => {
    expect(segmentsEdit([...L], { up: 'path' })).toEqual(['path', 'model', 'git'])
    expect(segmentsEdit([...L], { up: 'model' })).toEqual(['model', 'path', 'git'])
    expect(segmentsEdit([...L], { down: 'path' })).toEqual(['model', 'git', 'path'])
    expect(segmentsEdit([...L], { down: 'git' })).toEqual(['model', 'path', 'git'])
    expect(segmentsEdit([...L], { remove: 'path' })).toEqual(['model', 'git'])
    expect(segmentsEdit([...L], { add: 'ctx' })).toEqual(['model', 'path', 'git', 'ctx'])
    expect(segmentsEdit([...L], { add: 'git' })).toEqual(['model', 'path', 'git'])
  })
})

describe('rulesRows', () => {
  const rule = (name: string, source: Rule['source'], extra: Partial<Rule> = {}): Rule => ({ name, path: `/${name}.md`, content: '', source, enabled: true, ...extra })
  test('kind and disabled state, sorted by name', () => {
    const rows = rulesRows(
      [rule('t', 'builtin', { condition: ['x'] }), rule('a', 'global', { alwaysApply: true }), rule('b', 'project', { description: 'd' })],
      { builtin: true, disabled: ['b'] },
    )
    expect(rows).toEqual([
      { name: 'a', source: 'global', kind: 'always', disabled: false },
      { name: 'b', source: 'project', kind: 'rulebook', disabled: true },
      { name: 't', source: 'builtin', kind: 'ttsr', disabled: false },
    ])
  })
  test('builtin:false marks builtins disabled', () => {
    expect(rulesRows([rule('t', 'builtin', { condition: ['x'] })], { builtin: false, disabled: [] })[0]?.disabled).toBe(true)
  })
})

describe('previewSegments', () => {
  const BUILTIN = JSON.parse(readFileSync(join(import.meta.dir, '..', 'themes', 'builtin.json'), 'utf8'))
  test('follows left then right order, coloured from the theme', () => {
    const config = { ...schemaDefaults().statusline, left: ['path', 'model'] as const, right: ['cost'] as const }
    const theme = resolveTheme('dark', BUILTIN, {}).theme
    const p = previewSegments({ ...config, left: [...config.left], right: [...config.right] }, theme)
    expect(p.map(s => s.id)).toEqual(['path', 'model', 'cost'])
    expect(p[1]?.colour).toBe(toHex(theme.statusLineModel))
    expect(p[1]?.text).toContain('Opus')
  })
})

import { themeGroups } from '../hooks/pane-model'

describe('themeGroups (Select allows at most 64 options)', () => {
  const BUILTIN = JSON.parse(readFileSync(join(import.meta.dir, '..', 'themes', 'builtin.json'), 'utf8'))
  test('every group has 1 to 64 themes and every theme is in exactly one group', () => {
    const names = [...Object.keys(BUILTIN), 'mine', 'zz-custom']
    const groups = themeGroups(names)
    for (const g of groups) {
      expect(g.names.length).toBeGreaterThan(0)
      expect(g.names.length).toBeLessThanOrEqual(64)
    }
    expect(groups.flatMap(g => g.names).sort()).toEqual([...names].sort())
    expect(groups.length).toBeLessThanOrEqual(64)
  })
  test('families: dark, light, other; an oversized family is paged', () => {
    const labels = themeGroups(['dark', 'dark-a', 'light', 'light-b', 'onyx']).map(g => g.label)
    expect(labels).toEqual(['dark', 'light', 'other'])
    const many = Array.from({ length: 130 }, (_, i) => `dark-${String(i).padStart(3, '0')}`)
    const paged = themeGroups(many)
    expect(paged.map(g => g.label)).toEqual(['dark 1/3', 'dark 2/3', 'dark 3/3'])
  })
})
