// Nerd-font powerline status line in the spirit of omp's `nerd` preset:
// left  model · mode · path · git · pr   right  session · tokens · cost · ctx%

export type StatusInput = {
  cwd?: string
  session_name?: string
  model?: { id?: string; display_name?: string }
  workspace?: { current_dir?: string }
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

import type { Caveman } from './caveman'

export type GitInfo = { branch: string; dirty: boolean; ahead: number; behind: number }

export const SEP = ''

const ICON = {
  model: '\u{f06a9}',
  mode: '',
  path: '',
  git: '',
  pr: '',
  session: '',
  tokens: '',
  cost: '',
  ctx: '',
  limit: '\u{f051f}',
}

const color = (code: number, text: string) => `\x1b[38;5;${code}m${text}\x1b[0m`
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const base = (p: string) => p.split(/[\\/]+/).filter(Boolean).pop() ?? p

type Seg = string | undefined

function model(i: StatusInput): Seg {
  const name = i.model?.display_name ?? i.model?.id
  return name ? color(141, `${ICON.model} ${name}`) : undefined
}

function caveman(c: Caveman | undefined): Seg {
  if (!c) return undefined
  let text = `🪨 ${c.mode || 'CAVEMAN'}`
  if (c.savings) text += ` ⛏ ${c.savings}`
  return color(172, text)
}

function mode(i: StatusInput): Seg {
  return i.vim?.mode ? color(214, `${ICON.mode} ${i.vim.mode}`) : undefined
}

function path(i: StatusInput): Seg {
  const dir = i.workspace?.current_dir ?? i.cwd
  return dir ? color(75, `${ICON.path} ${base(dir)}`) : undefined
}

function git(g: GitInfo | undefined): Seg {
  if (!g) return undefined
  let text = `${ICON.git} ${g.branch}${g.dirty ? '*' : ''}`
  if (g.ahead) text += ` ↑${g.ahead}`
  if (g.behind) text += ` ↓${g.behind}`
  return color(g.dirty ? 179 : 114, text)
}

function pr(i: StatusInput): Seg {
  return i.pr?.number ? color(176, `${ICON.pr} #${i.pr.number}`) : undefined
}

function session(i: StatusInput): Seg {
  return i.session_name ? color(250, `${ICON.session} ${i.session_name}`) : undefined
}

function tokens(i: StatusInput): Seg {
  const c = i.context_window
  const total = (c?.total_input_tokens ?? 0) + (c?.total_output_tokens ?? 0)
  return total > 0 ? color(110, `${ICON.tokens} ${formatTokens(total)}`) : undefined
}

function cost(i: StatusInput): Seg {
  const usd = i.cost?.total_cost_usd
  return typeof usd === 'number' ? color(150, `${ICON.cost} $${usd.toFixed(2)}`) : undefined
}

function ctx(i: StatusInput): Seg {
  const pct = i.context_window?.used_percentage
  if (typeof pct !== 'number') return undefined
  const code = pct >= 80 ? 203 : pct >= 50 ? 179 : 114
  return color(code, `${ICON.ctx} ${Math.round(pct)}%`)
}

export function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '<1m'
  const h = Math.floor(min / 60)
  return h > 0 ? `${h}h${String(min % 60).padStart(2, '0')}m` : `${min}m`
}

function fiveHour(i: StatusInput, now: number): Seg {
  const w = i.rate_limits?.five_hour
  if (typeof w?.used_percentage !== 'number') return undefined
  const left = Math.max(0, Math.round(100 - w.used_percentage))
  let text = `${ICON.limit} ${left}% left`
  if (typeof w.resets_at === 'number' && w.resets_at * 1000 > now) text += ` · ${formatDuration(w.resets_at * 1000 - now)}`
  return color(left < 20 ? 203 : left < 50 ? 179 : 114, text)
}

const join = (segs: Seg[]) => segs.filter((s): s is string => s !== undefined).join(` ${dim(SEP)} `)

export function render(input: StatusInput, opts: { git: GitInfo | undefined; caveman?: Caveman; now?: number }): string {
  const i = input ?? {}
  const left = join([model(i), caveman(opts.caveman), mode(i), path(i), git(opts.git), pr(i)])
  const right = join([session(i), tokens(i), cost(i), fiveHour(i, opts.now ?? Date.now()), ctx(i)])
  return [left, right].filter(Boolean).join(`  ${dim(SEP + SEP)}  `)
}
