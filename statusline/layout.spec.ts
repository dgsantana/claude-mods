import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { schemaDefaults } from '../plugins/omp-port/hooks/settings-schema'
import type { StatuslineConfig } from '../plugins/omp-port/hooks/statusline-config'
import { resolveTheme } from '../plugins/omp-port/hooks/themes'
import { render, type StatusInput } from './segments'

const BUILTIN = JSON.parse(readFileSync(join(import.meta.dir, '..', 'plugins', 'omp-port', 'themes', 'builtin.json'), 'utf8'))
const theme = (n: string) => resolveTheme(n, BUILTIN, {}).theme
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
const cfg = (over: Partial<StatuslineConfig> = {}): StatuslineConfig => ({ ...schemaDefaults().statusline, ...over })
const INPUT: StatusInput = {
  model: { display_name: 'Opus' },
  workspace: { current_dir: '/home/u/projects/app' },
  cost: { total_cost_usd: 0.5 },
  context_window: { total_input_tokens: 1000, total_output_tokens: 0, used_percentage: 60 },
}
const opts = (over: Record<string, unknown> = {}) => ({ git: { branch: 'main', dirty: false, ahead: 2, behind: 1 }, config: cfg(), theme: theme('dark'), truecolor: true, home: '/home/u', ...over })

describe('layout', () => {
  test('order follows left/right; unlisted segments not drawn', () => {
    const out = strip(render(INPUT, opts({ config: cfg({ left: ['path', 'model'], right: ['cost'] }) })))
    expect(out.indexOf('app')).toBeLessThan(out.indexOf('Opus'))
    expect(out).toContain('$0.50')
    expect(out).not.toContain('60%')
    expect(out).not.toContain('main')
  })
  test('separator styles', () => {
    const sep = (s: StatuslineConfig['separator']) => strip(render(INPUT, opts({ config: cfg({ separator: s, left: ['model', 'path'], right: [] }) })))
    expect(sep('powerline-thin')).toContain('\ue0b1')
    expect(sep('slash')).toContain(' / ')
    expect(sep('pipe')).toContain(' │ ')
    expect(sep('block')).toContain(' ▌ ')
    expect(sep('ascii')).toContain(' > ')
    expect(sep('none')).toMatch(/Opus {2}\S/)
  })
  test('powerline draws the theme background and arrows', () => {
    const t = theme('dark')
    const out = render(INPUT, opts({ config: cfg({ separator: 'powerline', left: ['model', 'path'], right: [] }) }))
    expect(out).toContain(`48;2;${t.statusLineBg.r};${t.statusLineBg.g};${t.statusLineBg.b}`)
    expect(strip(out)).toContain('\ue0b0')
  })
  test('icon sets', () => {
    const icons = (i: StatuslineConfig['icons']) => strip(render(INPUT, opts({ config: cfg({ icons: i, left: ['model'], right: ['cost'] }) })))
    expect(icons('nerd')).toContain('\u{f06a9} Opus')
    expect(icons('ascii')).toContain('M Opus')
    expect(icons('none')).toMatch(/^Opus/)
  })
  test('path styles, both separators', () => {
    const p = (style: StatuslineConfig['path']['style'], dir = '/home/u/projects/app') =>
      strip(render({ workspace: { current_dir: dir } }, opts({ config: cfg({ left: ['path'], right: [], icons: 'none', path: { style } }) })))
    expect(p('basename')).toBe('app')
    expect(p('full')).toBe('/home/u/projects/app')
    expect(p('home')).toBe('~/projects/app')
    expect(p('home', 'C:\\Users\\u\\proj')).toBe('C:\\Users\\u\\proj')
    expect(strip(render({ workspace: { current_dir: 'C:\\Users\\u\\proj' } }, opts({ home: 'C:\\Users\\u', config: cfg({ left: ['path'], right: [], icons: 'none', path: { style: 'home' } }) })))).toBe('~\\proj')
  })
  test('git ahead/behind toggle; 5h reset toggle', () => {
    const g = (aheadBehind: boolean) => strip(render(INPUT, opts({ config: cfg({ left: ['git'], right: [], git: { aheadBehind } }) })))
    expect(g(true)).toContain('↑2')
    expect(g(false)).not.toContain('↑')
    const NOW = 1_800_000_000_000
    const five = (showReset: boolean) =>
      strip(render({ rate_limits: { five_hour: { used_percentage: 10, resets_at: NOW / 1000 + 3600 } } }, opts({ now: NOW, config: cfg({ left: [], right: ['fiveHour'], fiveHour: { showReset } }) })))
    expect(five(true)).toContain('1h00m')
    expect(five(false)).not.toContain('1h00m')
  })
  test('ctx thresholds use theme success/warning/error', () => {
    const t = theme('dark')
    const code = (c: { r: number; g: number; b: number }) => `38;2;${c.r};${c.g};${c.b}m`
    const at = (pct: number) => render({ context_window: { used_percentage: pct } }, opts({ config: cfg({ left: [], right: ['ctx'], ctx: { warnAt: 50, errorAt: 80 } }) }))
    expect(at(10)).toContain(code(t.statusLineContext))
    expect(at(60)).toContain(code(t.warning))
    expect(at(90)).toContain(code(t.error))
  })
  test('256 mode never emits truecolor (Review Focus 4)', () => {
    const out = render(INPUT, opts({ truecolor: false, config: cfg({ separator: 'powerline' }) }))
    expect(out).not.toContain('38;2;')
    expect(out).not.toContain('48;2;')
    expect(out).toContain('38;5;')
  })
  test('themes change the model colour', () => {
    const m = (n: string) => render(INPUT, opts({ theme: theme(n), config: cfg({ left: ['model'], right: [] }) }))
    expect(m('dark')).not.toBe(m('light'))
  })
})
