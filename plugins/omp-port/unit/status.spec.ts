import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { schemaDefaults } from '../hooks/settings-schema'
import {
  type Caveman,
  cellWidth,
  formatDuration,
  formatTokens,
  modelLabel,
  parseCaveman,
  parsePorcelain,
  type Span,
  type StatusData,
  statusSpans,
} from '../hooks/status'
import type { StatuslineConfig } from '../hooks/statusline-config'
import { resolveTheme, toHex } from '../hooks/themes'

const BUILTIN = JSON.parse(readFileSync(join(import.meta.dir, '..', 'themes', 'builtin.json'), 'utf8'))
const theme = (n: string) => resolveTheme(n, BUILTIN, {}).theme
const DARK = theme('dark')
const cfg = (over: Partial<StatuslineConfig> = {}): StatuslineConfig => ({ ...schemaDefaults().statusline, fill: 'none', ...over })
const NOW = 1_800_000_000_000
const DATA: StatusData = {
  model: 'Opus 5.5',
  cwd: '/home/u/projects/app',
  home: '/home/u',
  git: { branch: 'main', dirty: false, ahead: 2, behind: 1 },
  tokens: 1000,
  percent: 60,
  usd: 0.5,
  now: NOW,
}
const text = (spans: Span[]) => spans.map(s => s.text).join('')
const line = (data: StatusData, config: StatuslineConfig, t = DARK, columns?: number) => {
  const { left, middle, right } = statusSpans(data, config, t, columns)
  return { left: text(left), middle: text(middle), right: text(right), spans: [...left, ...right], middleSpans: middle }
}

describe('parsePorcelain', () => {
  test('branch, ahead/behind and dirty from porcelain v2 output', () => {
    const out = '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b file.ts\n'
    expect(parsePorcelain(out)).toEqual({ branch: 'main', dirty: true, ahead: 2, behind: 1 })
  })
  test('clean detached head shows the short oid', () => {
    expect(parsePorcelain('# branch.oid abcdef1234\n# branch.head (detached)\n')).toEqual({ branch: 'abcdef1', dirty: false, ahead: 0, behind: 0 })
  })
  test('empty output is no repository', () => {
    expect(parsePorcelain('')).toBeUndefined()
  })
})

describe('parseCaveman', () => {
  test('no flag file: nothing', () => {
    expect(parseCaveman(undefined, undefined, true)).toBeUndefined()
  })
  test('mode upper-cased, case and newline ignored', () => {
    expect(parseCaveman('Ultra\n', undefined, true)).toEqual({ mode: 'ULTRA' })
  })
  test('full mode has no label; off is nothing', () => {
    expect(parseCaveman('full', undefined, true)).toEqual({ mode: '' })
    expect(parseCaveman('off', undefined, true)).toBeUndefined()
  })
  test('unknown mode or escape bytes: nothing', () => {
    expect(parseCaveman('\x1b]8;;evil\x07', undefined, true)).toBeUndefined()
    expect(parseCaveman('shouty', undefined, true)).toBeUndefined()
  })
  test('flag past 64 characters is cut before it is checked', () => {
    expect(parseCaveman('ultra' + ' '.repeat(100) + 'x', undefined, true)).toEqual({ mode: 'ULTRA' })
  })
  test('savings suffix: control bytes stripped, capped at 64, switch hides it', () => {
    const c = parseCaveman('ultra', '41% saved\x1b[31m' + 'x'.repeat(100), true) as Caveman
    expect(c.savings?.startsWith('41% saved[31m')).toBe(true)
    expect(c.savings?.length).toBeLessThanOrEqual(64)
    expect(c.savings).not.toContain('\x1b')
    expect(parseCaveman('ultra', '41% saved', false)).toEqual({ mode: 'ULTRA' })
  })
})

describe('modelLabel', () => {
  test('Claude ids become family and version', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
  })
  test('anything else is kept as given', () => {
    expect(modelLabel('Opus 5.5')).toBe('Opus 5.5')
    expect(modelLabel('gpt-x')).toBe('gpt-x')
  })
})

describe('cellWidth', () => {
  test('one cell per character, two for emoji, one for Nerd Font glyphs', () => {
    expect(cellWidth('main ↑2')).toBe(7)
    expect(cellWidth('🪨 ULTRA')).toBe(8)
    expect(cellWidth('\u{f06a9} Opus')).toBe(6)
    expect(cellWidth('│─')).toBe(3)
  })
})

describe('fill', () => {
  const GAUGE: StatusData = { ...DATA, percent: 58, window: 1_000_000 }
  const fit = (data: StatusData, fill: StatuslineConfig['fill'], columns?: number) =>
    line(data, cfg({ fill, left: ['model'], right: ['cost'], icons: 'none' }), DARK, columns)
  test('gauge fills the row exactly, filled share by context use, then the window', () => {
    const l = fit(GAUGE, 'gauge', 80)
    expect(cellWidth(l.left + l.middle + l.right)).toBe(80)
    expect(l.middle).toContain('58%')
    expect(l.middle.trimEnd().endsWith('1M')).toBe(true)
    expect(l.middleSpans.find(s => s.text.includes('─'))?.color).toBe(toHex(DARK.warning))
    const bar = l.middle.replace(/[^─]/g, '').length
    const before = (l.middle.split('58%')[0] ?? '').replace(/[^─]/g, '').length
    expect(Math.abs(before / bar - 0.58)).toBeLessThan(0.1)
  })
  test('gauge without a reading is a plain line', () => {
    const l = fit({ ...DATA, percent: undefined }, 'gauge', 60)
    expect(cellWidth(l.left + l.middle + l.right)).toBe(60)
    expect(l.middle).not.toContain('%')
  })
  test('space pushes the right side to the edge', () => {
    const l = fit(GAUGE, 'space', 50)
    expect(cellWidth(l.left + l.middle + l.right)).toBe(50)
    expect(l.middle.trim()).toBe('')
  })
  test('none, an unknown width or too little room: a two-space gap', () => {
    expect(fit(GAUGE, 'none', 80).middle).toBe('  ')
    expect(fit(GAUGE, 'gauge').middle).toBe('  ')
    expect(fit(GAUGE, 'gauge', 20).middle).toBe('  ')
  })
})

describe('format helpers', () => {
  test('tokens', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(12_800)).toBe('12.8k')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
  test('durations', () => {
    expect(formatDuration(2 * 3600_000 + 13 * 60_000)).toBe('2h13m')
    expect(formatDuration(45 * 60_000)).toBe('45m')
    expect(formatDuration(20_000)).toBe('<1m')
  })
})

describe('statusSpans', () => {
  test('order follows left/right; unlisted segments are not drawn', () => {
    const l = line(DATA, cfg({ left: ['path', 'model'], right: ['cost'], icons: 'none' }))
    expect(l.left.indexOf('app')).toBeLessThan(l.left.indexOf('Opus'))
    expect(l.right).toContain('$0.50')
    expect(l.left + l.right).not.toContain('60%')
    expect(l.left + l.right).not.toContain('main')
  })
  test('a segment without data is left out', () => {
    const l = line({ now: NOW }, cfg())
    expect(l.left).toBe('')
    expect(l.right).toBe('')
  })
  test('separator styles', () => {
    const sep = (s: StatuslineConfig['separator']) => line(DATA, cfg({ separator: s, left: ['model', 'path'], right: [], icons: 'none' })).left
    expect(sep('powerline-thin')).toContain('\ue0b1')
    expect(sep('slash')).toContain(' / ')
    expect(sep('pipe')).toContain(' │ ')
    expect(sep('block')).toContain(' ▌ ')
    expect(sep('ascii')).toContain(' > ')
    expect(sep('none')).toBe('Opus 5.5  app')
  })
  test('powerline segments sit on the theme background and end in a cap', () => {
    const { left, right } = statusSpans(DATA, cfg({ separator: 'powerline', left: ['model', 'path'], right: ['cost'] }), DARK)
    const back = toHex(DARK.statusLineBg)
    expect(left.filter(s => s.text.includes('Opus')).every(s => s.backgroundColor === back)).toBe(true)
    const cap = left[left.length - 1]
    expect(cap).toEqual({ text: '\ue0b0', color: back })
    expect(right[0]).toEqual({ text: '\ue0b2', color: back })
  })
  test('icon sets', () => {
    const icons = (i: StatuslineConfig['icons']) => line(DATA, cfg({ icons: i, left: ['model'], right: [] })).left
    expect(icons('nerd')).toBe('\u{f06a9} Opus 5.5')
    expect(icons('ascii')).toBe('M Opus 5.5')
    expect(icons('none')).toBe('Opus 5.5')
  })
  test('path styles, both separators', () => {
    const p = (style: StatuslineConfig['path']['style'], cwd = '/home/u/projects/app', home = '/home/u') =>
      line({ cwd, home, now: NOW }, cfg({ left: ['path'], right: [], icons: 'none', path: { style } })).left
    expect(p('basename')).toBe('app')
    expect(p('full')).toBe('/home/u/projects/app')
    expect(p('home')).toBe('~/projects/app')
    expect(p('home', 'C:\\Users\\u\\proj')).toBe('C:\\Users\\u\\proj')
    expect(p('home', 'C:\\Users\\u\\proj', 'C:\\Users\\u')).toBe('~\\proj')
  })
  test('git: dirty mark and ahead/behind toggle', () => {
    const g = (aheadBehind: boolean, dirty = false) =>
      line({ ...DATA, git: { branch: 'main', dirty, ahead: 2, behind: 1 } }, cfg({ left: ['git'], right: [], icons: 'none', git: { aheadBehind } }))
    expect(g(true).left).toBe('main ↑2 ↓1')
    expect(g(false).left).toBe('main')
    expect(g(false, true).left).toBe('main*')
    expect(g(false, true).spans[0]?.color).toBe(toHex(DARK.statusLineGitDirty))
  })
  test('caveman after the model, with savings', () => {
    const l = line({ ...DATA, caveman: { mode: 'ULTRA', savings: '41% saved' } }, cfg({ left: ['model', 'caveman'], right: [], separator: 'none' }))
    expect(l.left).toContain('🪨 ULTRA ⛏ 41% saved')
    expect(line({ ...DATA, caveman: { mode: '' } }, cfg({ left: ['caveman'], right: [] })).left).toBe('🪨 CAVEMAN')
  })
  test('five-hour window: percent left, countdown only while in the future, colour by what is left', () => {
    const five = (used: number, resetsAt?: number, showReset = true) =>
      line({ now: NOW, fiveHour: { percentUsed: used, resetsAt } }, cfg({ left: [], right: ['fiveHour'], icons: 'none', fiveHour: { showReset } }))
    expect(five(23.4, NOW + 2 * 3600_000 + 13 * 60_000).right).toBe('77% left · 2h13m')
    expect(five(23.4, NOW + 3600_000, false).right).toBe('77% left')
    expect(five(50, NOW - 5000).right).toBe('50% left')
    expect(five(10).spans[0]?.color).toBe(toHex(DARK.success))
    expect(five(60).spans[0]?.color).toBe(toHex(DARK.warning))
    expect(five(90).spans[0]?.color).toBe(toHex(DARK.error))
  })
  test('ctx thresholds use the theme context, warning and error colours', () => {
    const at = (percent: number) => line({ now: NOW, percent }, cfg({ left: [], right: ['ctx'], ctx: { warnAt: 50, errorAt: 80 } })).spans[0]?.color
    expect(at(10)).toBe(toHex(DARK.statusLineContext))
    expect(at(60)).toBe(toHex(DARK.warning))
    expect(at(90)).toBe(toHex(DARK.error))
  })
  test('tokens and cost', () => {
    const l = line(DATA, cfg({ left: [], right: ['tokens', 'cost'], icons: 'none', separator: 'none' }))
    expect(l.right).toBe('1.0k  $0.50')
  })
  test('themes change the colours', () => {
    const m = (n: string) => line(DATA, cfg({ left: ['model'], right: [] }), theme(n)).spans[0]?.color
    expect(m('dark')).not.toBe(m('light'))
  })
})
