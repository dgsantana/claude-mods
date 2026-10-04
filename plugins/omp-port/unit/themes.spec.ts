import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEME_TOKENS, listThemes, parseColour, resolveTheme, type ThemeSpec } from '../hooks/themes'

const BUILTIN = JSON.parse(readFileSync(join(import.meta.dir, '..', 'themes', 'builtin.json'), 'utf8')) as Record<string, Record<string, string>>
const REQUIRED = THEME_TOKENS.filter(t => t !== 'statusLineCaveman')

describe('vendored themes', () => {
  test('102 themes, each with every required token as #rrggbb', () => {
    const names = Object.keys(BUILTIN)
    expect(names.length).toBe(102)
    expect(names).toContain('dark')
    expect(names).toContain('dark-tokyo-night')
    for (const n of names) for (const t of REQUIRED) expect(BUILTIN[n]![t]).toMatch(/^#[0-9a-f]{6}$/)
  })
  test('names are sorted', () => {
    const names = Object.keys(BUILTIN)
    expect(names).toEqual([...names].sort())
  })
})

describe('parseColour', () => {
  test('hex, short hex, 256 index, var chain', () => {
    expect(parseColour('#ff8000', {})).toEqual({ r: 255, g: 128, b: 0 })
    expect(parseColour('#f80', {})).toEqual({ r: 255, g: 136, b: 0 })
    expect(parseColour(196, {})).toEqual({ r: 255, g: 0, b: 0 })
    expect(parseColour(244, {})).toEqual({ r: 128, g: 128, b: 128 })
    expect(parseColour(4, {})).toEqual({ r: 0, g: 0, b: 128 })
    expect(parseColour('a', { a: 'b', b: '#010203' })).toEqual({ r: 1, g: 2, b: 3 })
  })
  test('var cycle and unknown names are undefined, no hang', () => {
    expect(parseColour('a', { a: 'b', b: 'a' })).toBeUndefined()
    expect(parseColour('nope', {})).toBeUndefined()
    expect(parseColour(300, {})).toBeUndefined()
  })
})

describe('resolveTheme', () => {
  test('builtin resolves every token; caveman defaults to #d7875f', () => {
    const { theme, warnings } = resolveTheme('dark', BUILTIN, {})
    expect(warnings).toEqual([])
    for (const t of THEME_TOKENS) expect(theme[t]).toBeDefined()
    expect(theme.statusLineCaveman).toEqual({ r: 0xd7, g: 0x87, b: 0x5f })
  })
  test('custom extends builtin, overrides some tokens, vars resolve', () => {
    const custom: Record<string, ThemeSpec> = { mine: { extends: 'dark', vars: { hot: '#ff0000' }, colors: { statusLineModel: 'hot' } } }
    const { theme } = resolveTheme('mine', BUILTIN, custom)
    expect(theme.statusLineModel).toEqual({ r: 255, g: 0, b: 0 })
    expect(theme.statusLinePath).toEqual(resolveTheme('dark', BUILTIN, {}).theme.statusLinePath)
  })
  test('custom without extends inherits from dark; custom overrides builtin by name', () => {
    const custom: Record<string, ThemeSpec> = { dark: { colors: { statusLineModel: '#000001' } } }
    expect(resolveTheme('dark', BUILTIN, custom).theme.statusLineModel).toEqual({ r: 0, g: 0, b: 1 })
  })
  test('extends chain across customs', () => {
    const custom: Record<string, ThemeSpec> = {
      a: { extends: 'b', colors: { statusLineModel: '#000001' } },
      b: { extends: 'dark-nord', colors: { statusLinePath: '#000002' } },
    }
    const { theme } = resolveTheme('a', BUILTIN, custom)
    expect(theme.statusLineModel).toEqual({ r: 0, g: 0, b: 1 })
    expect(theme.statusLinePath).toEqual({ r: 0, g: 0, b: 2 })
  })
  test('extends cycle or unknown parent → dark with one warning', () => {
    const cyc: Record<string, ThemeSpec> = { a: { extends: 'b', colors: {} }, b: { extends: 'a', colors: {} } }
    const r1 = resolveTheme('a', BUILTIN, cyc)
    expect(r1.warnings).toHaveLength(1)
    expect(r1.theme.statusLineModel).toEqual(resolveTheme('dark', BUILTIN, {}).theme.statusLineModel)
    const r2 = resolveTheme('x', BUILTIN, { x: { extends: 'missing', colors: {} } })
    expect(r2.warnings).toHaveLength(1)
  })
  test('unknown theme → dark + warning; bad colour in custom → inherited + warning', () => {
    expect(resolveTheme('nope', BUILTIN, {}).warnings[0]).toContain('nope')
    const r = resolveTheme('m', BUILTIN, { m: { colors: { statusLineModel: 'zzz' } } })
    expect(r.warnings.some(w => w.includes('statusLineModel'))).toBe(true)
    expect(r.theme.statusLineModel).toEqual(resolveTheme('dark', BUILTIN, {}).theme.statusLineModel)
  })
})

describe('listThemes', () => {
  test('merged, sorted, unique', () => {
    const names = listThemes(BUILTIN, { zzz: { colors: {} }, dark: { colors: {} } })
    expect(names.filter(n => n === 'dark')).toHaveLength(1)
    expect(names.at(-1)).toBe('zzz')
    expect(names).toEqual([...names].sort())
  })
})
