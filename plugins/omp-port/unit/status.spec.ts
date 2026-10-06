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
  git: { branch: 'main', dirty: false, ahead: 2, behind: 1, sha: '01a0fde', staged: 0, unstaged: 0, untracked: 0 },
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
    expect(parsePorcelain(out)).toEqual({ branch: 'main', dirty: true, ahead: 2, behind: 1, sha: 'abc', staged: 0, unstaged: 1, untracked: 0 })
  })
  test('clean detached head shows the short oid', () => {
    expect(parsePorcelain('# branch.oid abcdef1234\n# branch.head (detached)\n')).toEqual({
      branch: 'abcdef1', dirty: false, ahead: 0, behind: 0, sha: 'abcdef1', staged: 0, unstaged: 0, untracked: 0,
    })
  })
  test('staged, unstaged, untracked and conflicted entries are counted', () => {
    const out = [
      '# branch.oid 01a0fde4c0ffee', '# branch.head main',
      '1 M. N... 100644 100644 100644 a b staged.ts',
      '1 MM N... 100644 100644 100644 a b both.ts',
      '1 .D N... 100644 100644 000000 a b gone.ts',
      '2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      '? notes.md', '? tmp/', '',
    ].join('\n')
    expect(parsePorcelain(out)).toEqual({ branch: 'main', dirty: true, ahead: 0, behind: 0, sha: '01a0fde', staged: 3, unstaged: 3, untracked: 2 })
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

describe('dropping by priority', () => {
  const ALL: StatusData = {
    ...DATA, percent: 58, window: 1_000_000, startedAt: NOW - 26 * 60_000, caveman: { mode: 'ULTRA' },
    fiveHour: { percentUsed: 20 }, lastTurn: { usd: 0.1, tokens: 1000 },
  }
  const C = cfg({ icons: 'none', separator: 'none', left: ['model', 'caveman', 'path', 'git'], right: ['delta', 'tokens', 'cost', 'fiveHour', 'duration'] })
  test('a row that fits keeps every segment', () => {
    const l = line(ALL, C, DARK, 200)
    expect(l.left).toContain('ULTRA')
    expect(l.right).toContain('+$0.10')
  })
  test('a narrow row drops the lowest priority first and never exceeds the width', () => {
    const l = line(ALL, C, DARK, 60)
    expect(cellWidth(l.left + l.middle + l.right)).toBeLessThanOrEqual(60)
    expect(l.left).toContain('Opus 5.5')
    expect(l.left).toContain('main')
    expect(l.right).toContain('$0.50')
    expect(l.left).not.toContain('ULTRA')
    expect(l.right).not.toContain('+$0.10')
  })
  test('order is kept for what remains', () => {
    const l = line(ALL, C, DARK, 60)
    expect(l.left.indexOf('Opus')).toBeLessThan(l.left.indexOf('main'))
  })
  test('without a width nothing is dropped', () => {
    expect(line(ALL, C).left).toContain('ULTRA')
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
    expect(formatDuration(3 * 86_400_000 + 4 * 3600_000 + 59 * 60_000)).toBe('3d04h')
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
  test('git: ahead/behind and counts toggles; the dirty mark stands in when counts are off', () => {
    const CLEAN = { branch: 'main', dirty: false, ahead: 2, behind: 1, sha: '01a0fde', staged: 0, unstaged: 0, untracked: 0 }
    const DIRTY = { ...CLEAN, dirty: true, staged: 3, unstaged: 2, untracked: 5 }
    const g = (git: typeof CLEAN, aheadBehind: boolean, counts: boolean) =>
      line({ ...DATA, git }, cfg({ left: ['git'], right: [], icons: 'none', git: { aheadBehind, counts } }))
    expect(g(CLEAN, true, true).left).toBe('main ↑2 ↓1')
    expect(g(CLEAN, false, true).left).toBe('main')
    expect(g(DIRTY, false, true).left).toBe('main +3 ~2 ?5')
    expect(g(DIRTY, false, false).left).toBe('main*')
    expect(g(DIRTY, false, false).spans[0]?.color).toBe(toHex(DARK.statusLineGitDirty))
  })
  test('sha: the short commit id', () => {
    expect(line(DATA, cfg({ left: ['sha'], right: [], icons: 'none' })).left).toBe('01a0fde')
    expect(line({ ...DATA, git: undefined }, cfg({ left: ['sha'], right: [], icons: 'none' })).left).toBe('')
  })
  test('seven-day window: like the five-hour one, with a day-long countdown', () => {
    const seven = (used: number, resetsAt?: number, showReset = true) =>
      line({ now: NOW, sevenDay: { percentUsed: used, resetsAt } }, cfg({ left: [], right: ['sevenDay'], icons: 'none', sevenDay: { showReset } }))
    expect(seven(18, NOW + 3 * 86_400_000 + 4 * 3600_000).right).toBe('82% left · 3d04h')
    expect(seven(18, NOW + 3600_000, false).right).toBe('82% left')
    expect(seven(90).spans[0]?.color).toBe(toHex(DARK.error))
    expect(line({ now: NOW }, cfg({ left: [], right: ['sevenDay'] })).right).toBe('')
  })
  test('delta: what the last turn cost and how it moved the context', () => {
    const d = (lastTurn?: StatusData['lastTurn']) => line({ now: NOW, lastTurn }, cfg({ left: [], right: ['delta'], icons: 'none' })).right
    expect(d({ usd: 0.124, tokens: 98_300 })).toBe('+$0.12 +98.3k')
    expect(d({ usd: 0.5, tokens: -40_000 })).toBe('+$0.50 -40.0k')
    expect(d({ usd: 0.001, tokens: 0 })).toBe('')
    expect(d()).toBe('')
  })
  test('activity: TTSR hits and advisor spend, a mark for a pending note', () => {
    const a = (activity?: StatusData['activity']) => line({ now: NOW, activity }, cfg({ left: [], right: ['activity'], icons: 'none' })).right
    expect(a({ ttsrHits: 2 })).toBe('ttsr 2')
    expect(a({ ttsrHits: 0, advisor: { usd: 0.031, note: false } })).toBe('adv $0.03')
    expect(a({ ttsrHits: 1, advisor: { usd: 0.2, note: true } })).toBe('ttsr 1 · adv $0.20 !')
    expect(a({ ttsrHits: 0 })).toBe('')
    expect(a()).toBe('')
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
  test('duration: time since the session began; nothing without a start', () => {
    const d = (startedAt?: number) => line({ now: NOW, startedAt }, cfg({ left: [], right: ['duration'], icons: 'none' })).right
    expect(d(NOW - (26 * 60_000 + 34_000))).toBe('26m')
    expect(d(NOW - 3 * 3600_000)).toBe('3h00m')
    expect(d()).toBe('')
    expect(line({ now: NOW, startedAt: NOW - 60_000 }, cfg({ left: [], right: ['duration'], icons: 'nerd' })).right).toBe(' 1m')
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
