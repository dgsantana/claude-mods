// Status line themes: omp's built-in palettes (vendored, already hex) plus
// custom themes from `.agents/mods/themes/*.json` that may extend any theme.

export const THEME_TOKENS = [
  'statusLineBg',
  'statusLineSep',
  'statusLineModel',
  'statusLinePath',
  'statusLineGitClean',
  'statusLineGitDirty',
  'statusLineContext',
  'statusLineSpend',
  'statusLineOutput',
  'statusLineCost',
  'statusLineCaveman',
  'accent',
  'success',
  'warning',
  'error',
  'dim',
] as const

export type ThemeToken = (typeof THEME_TOKENS)[number]
export type Colour = string | number
export type Rgb = { r: number; g: number; b: number }
export type ThemeSpec = { extends?: string; vars?: Record<string, Colour>; colors: Partial<Record<string, Colour>> }
export type ResolvedTheme = Record<ThemeToken, Rgb>

const FALLBACK = 'dark'
const CAVEMAN_DEFAULT = '#d7875f'

const BASE16 = [
  '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
]
const CUBE = [0, 95, 135, 175, 215, 255]

export function xterm256(i: number): Rgb | undefined {
  if (!Number.isInteger(i) || i < 0 || i > 255) return undefined
  if (i < 16) return hex(BASE16[i] ?? '')
  if (i < 232) {
    const n = i - 16
    return { r: CUBE[Math.floor(n / 36)] ?? 0, g: CUBE[Math.floor(n / 6) % 6] ?? 0, b: CUBE[n % 6] ?? 0 }
  }
  const v = 8 + 10 * (i - 232)
  return { r: v, g: v, b: v }
}

function hex(s: string): Rgb | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (!m) return undefined
  let h = m[1] ?? ''
  if (h.length === 3) h = [...h].map(c => c + c).join('')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

export function toHex(c: Rgb): string {
  return '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')
}

// A colour: `#rrggbb`, `#rgb`, an xterm index 0–255, or a name looked up in
// `lookup` (vars and other tokens), followed until it lands on one of those.
export function parseColour(c: Colour, lookup: Record<string, Colour>): Rgb | undefined {
  const seen = new Set<string>()
  let cur: Colour | undefined = c
  while (cur !== undefined) {
    if (typeof cur === 'number') return xterm256(cur)
    if (/^\d+$/.test(cur)) return xterm256(Number(cur))
    if (cur.startsWith('#')) return hex(cur)
    if (seen.has(cur)) return undefined
    seen.add(cur)
    cur = lookup[cur]
  }
  return undefined
}

type Raw = { colors: Record<string, Colour>; vars: Record<string, Colour> }

export function resolveTheme(
  name: string,
  builtins: Record<string, Record<string, Colour>>,
  custom: Record<string, ThemeSpec>,
): { theme: ResolvedTheme; warnings: string[] } {
  const warnings: string[] = []
  const fallbackRaw = (): Raw => ({ colors: { ...(builtins[FALLBACK] ?? {}) }, vars: {} })

  // Flattens a theme and its `extends` chain into one raw map, base first.
  const build = (n: string, seen: Set<string>, preferCustom: boolean): Raw | undefined => {
    const spec = preferCustom ? custom[n] : undefined
    if (spec) {
      if (seen.has(n)) return undefined
      seen.add(n)
      let base: Raw | undefined
      if (spec.extends !== undefined) {
        base = build(spec.extends, seen, spec.extends !== n)
        if (!base) return undefined
      } else {
        base = builtins[n] ? { colors: { ...builtins[n] }, vars: {} } : fallbackRaw()
      }
      const colors = { ...base.colors }
      for (const [k, v] of Object.entries(spec.colors ?? {})) if (v !== undefined) colors[k] = v
      return { colors, vars: { ...base.vars, ...(spec.vars ?? {}) } }
    }
    const b = builtins[n]
    return b ? { colors: { ...b }, vars: {} } : undefined
  }

  let raw = build(name, new Set(), true)
  if (!raw) {
    warnings.push(
      custom[name]
        ? `theme "${name}": extends chain is cyclic or names an unknown theme; using ${FALLBACK}`
        : `theme "${name}" not found; using ${FALLBACK}`,
    )
    raw = fallbackRaw()
  }

  const base = fallbackRaw().colors
  const lookup = { ...raw.colors, ...raw.vars }
  const theme = {} as ResolvedTheme
  for (const token of THEME_TOKENS) {
    const value = raw.colors[token]
    let rgb = value === undefined ? undefined : parseColour(value, lookup)
    if (value !== undefined && !rgb) warnings.push(`theme "${name}": ${token} "${value}" is not a colour`)
    if (!rgb) {
      const fb = base[token] ?? (token === 'statusLineCaveman' ? CAVEMAN_DEFAULT : undefined)
      rgb = fb === undefined ? undefined : parseColour(fb, base)
    }
    theme[token] = rgb ?? { r: 192, g: 192, b: 192 }
  }
  return { theme, warnings }
}

export function listThemes(builtins: Record<string, unknown>, custom: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(builtins), ...Object.keys(custom)])].sort()
}
