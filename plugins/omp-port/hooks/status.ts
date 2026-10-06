// The status line band: what register.tsx gathers each refresh (StatusData)
// and how it is laid out as coloured spans in the configured theme, separator
// style and icon set.

import type { Activity, Caveman, GitInfo, RateWindow, StatusData, TurnDelta } from '../types'
import type { SegmentId } from './settings-schema'
import type { StatuslineConfig } from './statusline-config'
import { type ResolvedTheme, type ThemeToken, toHex } from './themes'

export type { Activity, Caveman, GitInfo, RateWindow, StatusData, TurnDelta }

export type Span = { text: string; color: string; backgroundColor?: string }

export function parsePorcelain(out: string): GitInfo | undefined {
  if (out.trim() === '') return undefined
  let branch = ''
  let oid = ''
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
    else if (line.startsWith('# branch.head ')) branch = line.slice(14).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      ahead = Number(m?.[1] ?? 0)
      behind = Number(m?.[2] ?? 0)
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // `XY`: the index (staged) state, then the worktree state; `.` is unchanged.
      if (line[2] !== '.') staged++
      if (line[3] !== '.') unstaged++
    } else if (line.startsWith('u ')) unstaged++
    else if (line.startsWith('? ')) untracked++
  }
  const sha = oid.slice(0, 7)
  if (branch === '(detached)' || branch === '') branch = sha
  return { branch, dirty: staged + unstaged + untracked > 0, ahead, behind, sha, staged, unstaged, untracked }
}

// Caveman's flag files, read the way its own status line reads them: each cut
// to 64 characters, the mode held to a whitelist, control bytes stripped
// from the savings suffix.
const CAVEMAN_MODES: readonly string[] = [
  'off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra', 'commit', 'review', 'compress',
]
const CAVEMAN_CAP = 64

export function parseCaveman(flag: string | undefined, suffix: string | undefined, showSavings: boolean): Caveman | undefined {
  if (flag === undefined) return undefined
  const mode = flag.slice(0, CAVEMAN_CAP).replace(/[\r\n]/g, '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!CAVEMAN_MODES.includes(mode) || mode === 'off') return undefined
  const out: Caveman = { mode: mode === 'full' ? '' : mode.toUpperCase() }
  const savings = suffix?.slice(0, CAVEMAN_CAP).replace(/[\x00-\x1f\x7f]/g, '').trim()
  if (showSavings && savings) out.savings = savings
  return out
}

// `claude-opus-5-5[1m]` → `Opus 5.5 1M`; anything not shaped like a Claude id is kept.
export function modelLabel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?(?:\[(\w+)\])?$/.exec(id)
  if (!m) return id
  const [, family = '', major, minor, window] = m
  const label = `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`
  return window ? `${label} ${window.toUpperCase()}` : label
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '<1m'
  const h = Math.floor(min / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`
  return h > 0 ? `${h}h${String(min % 60).padStart(2, '0')}m` : `${min}m`
}

// Terminal cells a text takes: two for emoji and East Asian wide characters,
// none for joiners, variation selectors and combining marks, one otherwise
// (Nerd Font glyphs sit in the private use areas and are one cell).
const WIDE: readonly [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe],
  [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
  [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3],
  [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0xa4cf], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f000, 0x1faff], [0x20000, 0x3fffd],
]
const ZERO: readonly [number, number][] = [[0x0300, 0x036f], [0x200b, 0x200f], [0xfe00, 0xfe0f], [0xe0100, 0xe01ef]]
const within = (ranges: readonly [number, number][], n: number) => ranges.some(([lo, hi]) => n >= lo && n <= hi)

export function cellWidth(text: string): number {
  let cells = 0
  for (const ch of text) {
    const n = ch.codePointAt(0) ?? 0
    cells += within(ZERO, n) ? 0 : within(WIDE, n) ? 2 : 1
  }
  return cells
}

function showPath(dir: string, style: StatuslineConfig['path']['style'], home: string | undefined): string {
  if (style === 'full') return dir
  if (style === 'home') {
    if (!home) return dir
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase()
    if (norm(dir) === norm(home)) return '~'
    if (norm(dir).startsWith(norm(home) + sep)) return '~' + dir.slice(home.replace(/[\\/]+$/, '').length)
    return dir
  }
  return dir.split(/[\\/]+/).filter(Boolean).pop() ?? dir
}

type IconKey = SegmentId | 'savings'
const ICONS: Record<StatuslineConfig['icons'], Record<IconKey, string>> = {
  nerd: {
    model: '\u{f06a9}', caveman: '🪨', savings: '⛏', path: '', git: '',
    tokens: '', cost: '', fiveHour: '\u{f051f}', ctx: '', duration: '\uf017', sha: '\uf417', sevenDay: '\uf073', delta: 'Δ', activity: '\uf0e7',
  },
  ascii: { model: 'M', caveman: 'cave', savings: '-', path: '@', git: 'git', tokens: 'T', cost: '', fiveHour: '5h', ctx: 'ctx', duration: 'up', sha: '#', sevenDay: '7d', delta: 'd', activity: 'mods' },
  none: { model: '', caveman: '', savings: '', path: '', git: '', tokens: '', cost: '', fiveHour: '', ctx: '', duration: '', sha: '', sevenDay: '', delta: '', activity: '' },
}

// Glyph between segments: [left side, right side].
const SEPARATOR_GLYPHS: Record<StatuslineConfig['separator'], [string, string]> = {
  powerline: ['', ''],
  'powerline-thin': ['', ''],
  slash: ['/', '/'],
  pipe: ['│', '│'],
  block: ['▌', '▐'],
  none: ['', ''],
  ascii: ['>', '<'],
}
// The filled arrows that close a powerline run: after the left side, before the right.
const POWERLINE_CAPS: [string, string] = ['', '']

type Seg = { text: string; colour: ThemeToken }
type Ctx = { data: StatusData; config: StatuslineConfig; icon: (k: IconKey) => string }

const labelled = (icon: string, text: string) => (icon ? `${icon} ${text}` : text)

const SEGMENTS: Record<SegmentId, (c: Ctx) => Seg | undefined> = {
  model: ({ data, icon }) => (data.model ? { text: labelled(icon('model'), modelLabel(data.model)), colour: 'statusLineModel' } : undefined),
  caveman: ({ data, icon }) => {
    const c = data.caveman
    if (!c) return undefined
    let text = labelled(icon('caveman'), c.mode || 'CAVEMAN')
    if (c.savings) text += ` ${labelled(icon('savings'), c.savings)}`
    return { text, colour: 'statusLineCaveman' }
  },
  path: ({ data, config, icon }) =>
    data.cwd ? { text: labelled(icon('path'), showPath(data.cwd, config.path.style, data.home)), colour: 'statusLinePath' } : undefined,
  git: ({ data, config, icon }) => {
    const g = data.git
    if (!g) return undefined
    let text = labelled(icon('git'), `${g.branch}${g.dirty && !config.git.counts ? '*' : ''}`)
    if (config.git.aheadBehind && g.ahead) text += ` ↑${g.ahead}`
    if (config.git.aheadBehind && g.behind) text += ` ↓${g.behind}`
    if (config.git.counts) {
      if (g.staged) text += ` +${g.staged}`
      if (g.unstaged) text += ` ~${g.unstaged}`
      if (g.untracked) text += ` ?${g.untracked}`
    }
    return { text, colour: g.dirty ? 'statusLineGitDirty' : 'statusLineGitClean' }
  },
  sha: ({ data, icon }) => (data.git?.sha ? { text: labelled(icon('sha'), data.git.sha), colour: 'dim' } : undefined),
  tokens: ({ data, icon }) =>
    data.tokens ? { text: labelled(icon('tokens'), formatTokens(data.tokens)), colour: 'statusLineOutput' } : undefined,
  cost: ({ data, icon }) =>
    typeof data.usd === 'number' ? { text: labelled(icon('cost'), `$${data.usd.toFixed(2)}`), colour: 'statusLineCost' } : undefined,
  fiveHour: ({ data, config, icon }) => rateSeg(data.fiveHour, data.now, config.fiveHour.showReset, icon('fiveHour')),
  sevenDay: ({ data, config, icon }) => rateSeg(data.sevenDay, data.now, config.sevenDay.showReset, icon('sevenDay')),
  ctx: ({ data, config, icon }) =>
    typeof data.percent === 'number'
      ? { text: labelled(icon('ctx'), `${Math.round(data.percent)}%`), colour: ctxColour(data.percent, config) }
      : undefined,
  delta: ({ data, icon }) => {
    const d = data.lastTurn
    if (!d) return undefined
    const parts: string[] = []
    if (d.usd >= 0.005) parts.push(`+$${d.usd.toFixed(2)}`)
    if (d.tokens !== 0) parts.push(`${d.tokens > 0 ? '+' : '-'}${formatTokens(Math.abs(d.tokens))}`)
    return parts.length ? { text: labelled(icon('delta'), parts.join(' ')), colour: 'statusLineSpend' } : undefined
  },
  activity: ({ data, icon }) => {
    const a = data.activity
    if (!a) return undefined
    const parts: string[] = []
    if (a.ttsrHits > 0) parts.push(`ttsr ${a.ttsrHits}`)
    if (a.advisor) parts.push(`adv $${a.advisor.usd.toFixed(2)}${a.advisor.note ? ' !' : ''}`)
    return parts.length ? { text: labelled(icon('activity'), parts.join(' · ')), colour: 'accent' } : undefined
  },
  duration: ({ data, icon }) =>
    data.startedAt !== undefined && data.now >= data.startedAt
      ? { text: labelled(icon('duration'), formatDuration(data.now - data.startedAt)), colour: 'dim' }
      : undefined,
}

// A usage window as the share left, coloured by it, with the time to its reset.
function rateSeg(w: RateWindow | undefined, now: number, showReset: boolean, icon: string): Seg | undefined {
  if (!w) return undefined
  const left = Math.max(0, Math.round(100 - w.percentUsed))
  let text = labelled(icon, `${left}% left`)
  if (showReset && w.resetsAt !== undefined && w.resetsAt > now) text += ` · ${formatDuration(w.resetsAt - now)}`
  return { text, colour: left < 20 ? 'error' : left < 50 ? 'warning' : 'success' }
}

// Which segments stay longest when the row is too narrow: the highest first.
const PRIORITY: Record<SegmentId, number> = {
  model: 10, git: 9, path: 8, ctx: 8, cost: 7, fiveHour: 7, sevenDay: 6, duration: 5,
  delta: 4, tokens: 3, sha: 3, caveman: 2, activity: 2,
}

function ctxColour(percent: number, config: StatuslineConfig): ThemeToken {
  return percent >= config.ctx.errorAt ? 'error' : percent >= config.ctx.warnAt ? 'warning' : 'statusLineContext'
}

// Below this many free cells the sides are only spaced apart.
const MIN_FILL = 12

// The room between the sides, `free` cells of it: omp's context gauge (a rule
// filled to the context share, the percent at the fill's end, the window
// size last) or blank space.
function fill(data: StatusData, config: StatuslineConfig, theme: ResolvedTheme, free: number): Span[] {
  const sep = toHex(theme.statusLineSep)
  if (config.fill === 'none' || free < MIN_FILL) return [{ text: '  ', color: sep }]
  if (config.fill === 'space') return [{ text: ' '.repeat(free), color: sep }]
  const win = data.window ? ` ${formatTokens(data.window).replace(/\.0(?=[kM]$)/, '')}` : ''
  if (typeof data.percent !== 'number') return [{ text: ` ${'─'.repeat(free - 2 - win.length)}${win} `, color: sep }]
  const pct = Math.max(0, Math.min(100, Math.round(data.percent)))
  const label = `${pct}%`
  const bar = free - 2 - label.length - win.length
  const filled = Math.round((bar * pct) / 100)
  const colour = toHex(theme[ctxColour(pct, config)])
  return [
    { text: ' ', color: sep },
    { text: '─'.repeat(filled), color: colour },
    { text: label, color: colour },
    { text: `${'─'.repeat(bar - filled)}${win} `, color: sep },
  ]
}

// The band's row as spans: the left segments, the fill between, the right
// segments. `columns` is the band's width; without it the sides are only
// spaced apart.
export function statusSpans(
  data: StatusData,
  config: StatuslineConfig,
  theme: ResolvedTheme,
  columns?: number,
): { left: Span[]; middle: Span[]; right: Span[] } {
  const ctx: Ctx = { data, config, icon: k => ICONS[config.icons][k] }
  const draw = (ids: readonly SegmentId[]) =>
    ids.flatMap(id => {
      const seg = SEGMENTS[id]?.(ctx)
      return seg ? [{ ...seg, id }] : []
    })
  let segs = { left: draw(config.left), right: draw(config.right) }
  let spans = sides(segs.left, segs.right, config, theme)
  // Too wide: drop the lowest-priority segment (the rightmost of equals) until it fits.
  const width = () => cellWidth([...spans.left, ...spans.right].map(s => s.text).join(''))
  while (columns !== undefined && width() + 2 > columns && segs.left.length + segs.right.length > 0) {
    const all = [...segs.left, ...segs.right]
    const victim = all.reduce((low, s) => (PRIORITY[s.id] <= PRIORITY[low.id] ? s : low))
    segs = { left: segs.left.filter(s => s !== victim), right: segs.right.filter(s => s !== victim) }
    spans = sides(segs.left, segs.right, config, theme)
  }
  return { ...spans, middle: fill(data, config, theme, columns === undefined ? 0 : columns - width()) }
}

function sides(left: Seg[], right: Seg[], config: StatuslineConfig, theme: ResolvedTheme): { left: Span[]; right: Span[] } {
  const [lg, rg] = SEPARATOR_GLYPHS[config.separator]
  const sep = toHex(theme.statusLineSep)

  if (config.separator === 'powerline') {
    const back = toHex(theme.statusLineBg)
    const run = (segs: Seg[], glyph: string): Span[] =>
      segs.flatMap((s, i) => [
        ...(i > 0 ? [{ text: glyph, color: sep, backgroundColor: back }] : []),
        { text: ` ${s.text} `, color: toHex(theme[s.colour]), backgroundColor: back },
      ])
    return {
      left: left.length ? [...run(left, lg), { text: POWERLINE_CAPS[0], color: back }] : [],
      right: right.length ? [{ text: POWERLINE_CAPS[1], color: back }, ...run(right, rg)] : [],
    }
  }

  const join = (segs: Seg[], glyph: string): Span[] =>
    segs.flatMap((s, i) => [
      ...(i > 0 ? [glyph ? { text: ` ${glyph} `, color: sep } : { text: '  ', color: sep }] : []),
      { text: s.text, color: toHex(theme[s.colour]) },
    ])
  return { left: join(left, lg), right: join(right, rg) }
}
