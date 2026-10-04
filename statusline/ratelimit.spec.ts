import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTheme } from '../plugins/omp-port/hooks/themes'
import { nearest256 } from './ansi'
import { formatDuration, render } from './segments'

const DARK = resolveTheme('dark', JSON.parse(readFileSync(join(import.meta.dir, '..', 'plugins', 'omp-port', 'themes', 'builtin.json'), 'utf8')), {}).theme

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
const NOW = 1_800_000_000_000

describe('5-hour usage segment', () => {
  test('shows percent left and time to reset, after cost', () => {
    const resets = NOW / 1000 + 2 * 3600 + 13 * 60
    const out = strip(
      render(
        { cost: { total_cost_usd: 0.5 }, rate_limits: { five_hour: { used_percentage: 23.4, resets_at: resets } } },
        { git: undefined, now: NOW },
      ),
    )
    expect(out).toContain('77% left · 2h13m')
    expect(out).not.toContain('undefined')
    expect(out.indexOf('$0.50')).toBeLessThan(out.indexOf('77% left'))
  })
  test('colour follows what is left', () => {
    const at = (used: number) => render({ rate_limits: { five_hour: { used_percentage: used } } }, { git: undefined, now: NOW })
    expect(at(10)).toContain(`38;5;${nearest256(DARK.success)}m`)
    expect(at(60)).toContain(`38;5;${nearest256(DARK.warning)}m`)
    expect(at(90)).toContain(`38;5;${nearest256(DARK.error)}m`)
  })
  test('absent or past reset: segment without countdown; absent window: no segment', () => {
    expect(strip(render({ rate_limits: { five_hour: { used_percentage: 50, resets_at: NOW / 1000 - 5 } } }, { git: undefined, now: NOW }))).toContain('50% left')
    expect(strip(render({ rate_limits: { five_hour: { used_percentage: 50, resets_at: NOW / 1000 - 5 } } }, { git: undefined, now: NOW }))).not.toContain('·')
    expect(strip(render({}, { git: undefined, now: NOW }))).not.toContain('left')
  })
})

describe('formatDuration', () => {
  test('h/m, minutes only, under a minute', () => {
    expect(formatDuration(2 * 3600_000 + 13 * 60_000)).toBe('2h13m')
    expect(formatDuration(45 * 60_000)).toBe('45m')
    expect(formatDuration(20_000)).toBe('<1m')
  })
})
