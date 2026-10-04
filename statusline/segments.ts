// The status line: segments from the layered `statusline` config, drawn in a
// theme's colours with the chosen separator style and icon set.

import BUILTIN_THEMES from '../plugins/omp-port/themes/builtin.json' with { type: 'json' }
import { schemaDefaults, type SegmentId } from '../plugins/omp-port/hooks/settings-schema'
import type { StatuslineConfig } from '../plugins/omp-port/hooks/statusline-config'
import { type ResolvedTheme, type Rgb, type ThemeToken, resolveTheme } from '../plugins/omp-port/hooks/themes'
import { bg, fg, RESET } from './ansi'
import type { Caveman } from './caveman'

export type StatusInput = {
  cwd?: string
  session_name?: string
  model?: { id?: string; display_name?: string }
  workspace?: { current_dir?: string; project_dir?: string }
  cost?: { total_cost_usd?: number }
  context_window?: {
    total_input_tokens?: number
    total_output_tokens?: number
    used_percentage?: number | null
  }
  vim?: { mode?: string }
  pr?: { number?: number; review_state?: string }
  rate_limits?: { five_hour?: { used_percentage?: number; resets_at?: number } }
}

export type GitInfo = { branch: string; dirty: boolean; ahead: number; behind: number }

export type RenderOptions = {
  git?: GitInfo
  caveman?: Caveman
  now?: number
  config?: StatuslineConfig
  theme?: ResolvedTheme
  truecolor?: boolean
  home?: string
}

export const SEP = ''

type IconKey = SegmentId | 'savings'
const ICONS: Record<StatuslineConfig['icons'], Record<IconKey, string>> = {
  nerd: {
    model: '\u{f06a9}', caveman: '🪨', savings: '⛏', mode: '', path: '', git: '', pr: '',
    session: '', tokens: '', cost: '', fiveHour: '\u{f051f}', ctx: '',
  },
  ascii: {
    model: 'M', caveman: 'cave', savings: '-', mode: 'V', path: '@', git: 'git', pr: 'PR',
    session: 'S', tokens: 'T', cost: '', fiveHour: '5h', ctx: 'ctx',
  },
  none: {
    model: '', caveman: '', savings: '', mode: '', path: '', git: '', pr: '',
    session: '', tokens: '', cost: '', fiveHour: '', ctx: '',
  },
}

// Glyph between segments (left side, right side).
const SEPARATOR_GLYPHS: Record<StatuslineConfig['separator'], [string, string]> = {
  powerline: ['', ''],
  'powerline-thin': ['', ''],
  slash: ['/', '/'],
  pipe: ['│', '│'],
  block: ['▌', '▐'],
  none: ['', ''],
  ascii: ['>', '<'],
}

let defaultTheme: ResolvedTheme | undefined

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '<1m'
  const h = Math.floor(min / 60)
  return h > 0 ? `${h}h${String(min % 60).padStart(2, '0')}m` : `${min}m`
}

type Seg = { text: string; colour: ThemeToken } | undefined
type Ctx = { input: StatusInput; opts: RenderOptions; config: StatuslineConfig; icon: (k: IconKey) => string; now: number }

const labelled = (icon: string, text: string) => (icon ? `${icon} ${text}` : text)

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

const SEGMENTS: Record<SegmentId, (c: Ctx) => Seg> = {
  model: ({ input, icon }) => {
    const name = input.model?.display_name ?? input.model?.id
    return name ? { text: labelled(icon('model'), name), colour: 'statusLineModel' } : undefined
  },
  caveman: ({ opts, icon }) => {
    const c = opts.caveman
    if (!c) return undefined
    let text = labelled(icon('caveman'), c.mode || 'CAVEMAN')
    if (c.savings) text += ` ${labelled(icon('savings'), c.savings)}`
    return { text, colour: 'statusLineCaveman' }
  },
  mode: ({ input, icon }) => (input.vim?.mode ? { text: labelled(icon('mode'), input.vim.mode), colour: 'accent' } : undefined),
  path: ({ input, opts, config, icon }) => {
    const dir = input.workspace?.current_dir ?? input.cwd
    return dir ? { text: labelled(icon('path'), showPath(dir, config.path.style, opts.home)), colour: 'statusLinePath' } : undefined
  },
  git: ({ opts, config, icon }) => {
    const g = opts.git
    if (!g) return undefined
    let text = labelled(icon('git'), `${g.branch}${g.dirty ? '*' : ''}`)
    if (config.git.aheadBehind && g.ahead) text += ` ↑${g.ahead}`
    if (config.git.aheadBehind && g.behind) text += ` ↓${g.behind}`
    return { text, colour: g.dirty ? 'statusLineGitDirty' : 'statusLineGitClean' }
  },
  pr: ({ input, icon }) => (input.pr?.number ? { text: labelled(icon('pr'), `#${input.pr.number}`), colour: 'accent' } : undefined),
  session: ({ input, icon }) =>
    input.session_name ? { text: labelled(icon('session'), input.session_name), colour: 'dim' } : undefined,
  tokens: ({ input, icon }) => {
    const c = input.context_window
    const total = (c?.total_input_tokens ?? 0) + (c?.total_output_tokens ?? 0)
    return total > 0 ? { text: labelled(icon('tokens'), formatTokens(total)), colour: 'statusLineOutput' } : undefined
  },
  cost: ({ input, icon }) => {
    const usd = input.cost?.total_cost_usd
    return typeof usd === 'number' ? { text: labelled(icon('cost'), `$${usd.toFixed(2)}`), colour: 'statusLineCost' } : undefined
  },
  fiveHour: ({ input, config, icon, now }) => {
    const w = input.rate_limits?.five_hour
    if (typeof w?.used_percentage !== 'number') return undefined
    const left = Math.max(0, Math.round(100 - w.used_percentage))
    let text = labelled(icon('fiveHour'), `${left}% left`)
    if (config.fiveHour.showReset && typeof w.resets_at === 'number' && w.resets_at * 1000 > now) {
      text += ` · ${formatDuration(w.resets_at * 1000 - now)}`
    }
    return { text, colour: left < 20 ? 'error' : left < 50 ? 'warning' : 'success' }
  },
  ctx: ({ input, config, icon }) => {
    const pct = input.context_window?.used_percentage
    if (typeof pct !== 'number') return undefined
    const colour = pct >= config.ctx.errorAt ? 'error' : pct >= config.ctx.warnAt ? 'warning' : 'statusLineContext'
    return { text: labelled(icon('ctx'), `${Math.round(pct)}%`), colour }
  },
}

function themeOrDefault(theme: ResolvedTheme | undefined): ResolvedTheme {
  if (theme) return theme
  defaultTheme ??= resolveTheme('dark', BUILTIN_THEMES as Record<string, Record<string, string>>, {}).theme
  return defaultTheme
}

export function render(input: StatusInput, opts: RenderOptions = {}): string {
  const config = opts.config ?? schemaDefaults().statusline
  const theme = themeOrDefault(opts.theme)
  const tc = opts.truecolor ?? false
  const ctx: Ctx = { input: input ?? {}, opts, config, icon: k => ICONS[config.icons][k], now: opts.now ?? Date.now() }
  const draw = (ids: readonly SegmentId[]) =>
    ids.map(id => SEGMENTS[id]?.(ctx)).filter((s): s is NonNullable<Seg> => s !== undefined)
  const left = draw(config.left)
  const right = draw(config.right)
  const paint = (rgb: Rgb, text: string) => `${fg(rgb, tc)}${text}${RESET}`
  const [lg, rg] = SEPARATOR_GLYPHS[config.separator]

  if (config.separator === 'powerline') {
    const back = theme.statusLineBg
    const run = (segs: typeof left, glyph: string) =>
      segs.map(s => `${bg(back, tc)}${fg(theme[s.colour], tc)} ${s.text} `).join(`${bg(back, tc)}${fg(theme.statusLineSep, tc)}${glyph}`)
    const l = left.length ? `${run(left, lg)}${RESET}${fg(back, tc)}${RESET}` : ''
    const r = right.length ? `${fg(back, tc)}${RESET}${run(right, rg)}${RESET}` : ''
    return [l, r].filter(Boolean).join(' ')
  }

  const join = (segs: typeof left, glyph: string) =>
    segs.map(s => paint(theme[s.colour], s.text)).join(glyph ? ` ${paint(theme.statusLineSep, glyph)} ` : '  ')
  const l = join(left, lg)
  const r = join(right, rg)
  const between = lg ? `  ${paint(theme.statusLineSep, lg + rg)}  ` : '    '
  return [l, r].filter(Boolean).join(between)
}
