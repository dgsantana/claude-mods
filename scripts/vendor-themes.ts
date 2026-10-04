#!/usr/bin/env bun
// Vendors oh-my-pi's built-in themes (MIT) as status-line palettes.
// Usage: bun scripts/vendor-themes.ts <omp>/packages/tui/src/theme
// Writes plugins/omp-port/themes/builtin.json: { name: { token: "#rrggbb" } }.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { THEME_TOKENS, parseColour, toHex, type Colour } from '../plugins/omp-port/hooks/themes'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: bun scripts/vendor-themes.ts <omp>/packages/tui/src/theme')
  process.exit(1)
}

const files = [
  join(dir, 'dark.json'),
  join(dir, 'light.json'),
  ...readdirSync(join(dir, 'defaults'))
    .filter(f => f.endsWith('.json'))
    .map(f => join(dir, 'defaults', f)),
]

const out: Record<string, Record<string, string>> = {}
for (const file of files) {
  const theme = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; vars?: Record<string, Colour>; colors: Record<string, Colour> }
  const name = basename(file, '.json')
  const lookup = { ...theme.colors, ...(theme.vars ?? {}) }
  const palette: Record<string, string> = {}
  for (const token of THEME_TOKENS) {
    const value = theme.colors[token]
    if (value === undefined) continue
    const rgb = parseColour(value, lookup)
    if (!rgb) throw new Error(`${name}: ${token} = ${value} does not resolve`)
    palette[token] = toHex(rgb)
  }
  out[name] = palette
}

const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]))
const target = join(import.meta.dir, '..', 'plugins', 'omp-port', 'themes', 'builtin.json')
mkdirSync(join(target, '..'), { recursive: true })
writeFileSync(target, JSON.stringify(sorted, null, 1) + '\n')
console.log(`wrote ${Object.keys(sorted).length} themes to ${target}`)
