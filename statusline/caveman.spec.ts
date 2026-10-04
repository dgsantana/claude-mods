import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCaveman } from './caveman'
import { render } from './segments'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'caveman-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readCaveman', () => {
  test('no flag file → undefined', () => {
    expect(readCaveman(dir, {})).toBeUndefined()
  })
  test('reads mode, upper-cases it, ignores case and newline', () => {
    writeFileSync(join(dir, '.caveman-active'), 'Ultra\n')
    expect(readCaveman(dir, {})).toEqual({ mode: 'ULTRA' })
  })
  test('full mode renders without suffix', () => {
    writeFileSync(join(dir, '.caveman-active'), 'full')
    expect(readCaveman(dir, {})).toEqual({ mode: '' })
  })
  test('unknown mode or escape bytes → undefined', () => {
    writeFileSync(join(dir, '.caveman-active'), '\x1b]8;;evil\x07')
    expect(readCaveman(dir, {})).toBeUndefined()
    writeFileSync(join(dir, '.caveman-active'), 'shouty')
    expect(readCaveman(dir, {})).toBeUndefined()
  })
  test('symlinked flag is refused', () => {
    writeFileSync(join(dir, 'target'), 'ultra')
    symlinkSync(join(dir, 'target'), join(dir, '.caveman-active'))
    expect(readCaveman(dir, {})).toBeUndefined()
  })
  test('savings suffix read, control bytes stripped, capped at 64', () => {
    writeFileSync(join(dir, '.caveman-active'), 'ultra')
    writeFileSync(join(dir, '.caveman-statusline-suffix'), '41% saved\x1b[31m' + 'x'.repeat(100))
    const c = readCaveman(dir, {})!
    expect(c.savings?.startsWith('41% saved[31m')).toBe(true)
    expect(c.savings!.length).toBeLessThanOrEqual(64)
    expect(c.savings).not.toContain('\x1b')
  })
  test('CAVEMAN_STATUSLINE_SAVINGS=0 hides the suffix', () => {
    writeFileSync(join(dir, '.caveman-active'), 'ultra')
    writeFileSync(join(dir, '.caveman-statusline-suffix'), '41% saved')
    expect(readCaveman(dir, { CAVEMAN_STATUSLINE_SAVINGS: '0' })).toEqual({ mode: 'ULTRA' })
  })
})

describe('caveman segment', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
  test('sits right after the model', () => {
    const out = strip(render({ model: { display_name: 'Opus' }, cwd: '/p/x' }, { git: undefined, caveman: { mode: 'ULTRA', savings: '41% saved' } }))
    expect(out.indexOf('Opus')).toBeLessThan(out.indexOf('ULTRA'))
    expect(out.indexOf('ULTRA')).toBeLessThan(out.indexOf('x'))
    expect(out).toContain('41% saved')
    expect(out).toContain('🪨 ULTRA ⛏ 41% saved')
  })
  test('full mode shows plain CAVEMAN', () => {
    expect(strip(render({}, { git: undefined, caveman: { mode: '' } }))).toContain('🪨 CAVEMAN')
  })
})
