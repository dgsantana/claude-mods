import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatTokens, render, SEP, type StatusInput } from './segments'

const fixture = (name: string): StatusInput => JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8'))
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
const git = { branch: 'main', dirty: true, ahead: 1, behind: 0 }

describe('render', () => {
  test('full input shows every segment in omp order, thin powerline separators', () => {
    const out = strip(render(fixture('full.json'), { git }))
    const order = ['Opus', 'NORMAL', 'claude-mods', 'main', '#1234', 'omp port', '16.7k', '$1.23', '8%']
    let at = -1
    for (const part of order) {
      const i = out.indexOf(part)
      expect(i).toBeGreaterThan(at)
      at = i
    }
    expect(out).toContain(SEP)
    expect(out).not.toContain('\n')
  })

  test('git dirty and ahead markers', () => {
    const out = strip(render(fixture('full.json'), { git }))
    expect(out).toMatch(/main\*/)
    expect(out).toContain('↑1')
  })

  test('minimal input: absent fields drop their segments, Windows cwd basename', () => {
    const out = strip(render(fixture('minimal.json'), { git: undefined }))
    expect(out).toContain('Sonnet')
    expect(out).toContain('proj')
    expect(out).not.toContain('#')
    expect(out).not.toContain('NORMAL')
    expect(out).not.toContain('%')
    expect(out).toContain('$0.00')
  })

  test('garbage input renders without throwing', () => {
    expect(() => render({} as StatusInput, { git: undefined })).not.toThrow()
  })
})

describe('formatTokens', () => {
  test('k and M suffixes', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(16700)).toBe('16.7k')
    expect(formatTokens(1_250_000)).toBe('1.3M')
  })
})
