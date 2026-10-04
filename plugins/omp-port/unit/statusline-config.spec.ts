import { describe, expect, test } from 'bun:test'
import { sanitizeStatusline } from '../hooks/statusline-config'
import { schemaDefaults } from '../hooks/settings-schema'

describe('sanitizeStatusline', () => {
  test('undefined → defaults, no warnings', () => {
    const r = sanitizeStatusline(undefined)
    expect(r.config).toEqual(schemaDefaults().statusline)
    expect(r.warnings).toEqual([])
  })
  test('valid values kept', () => {
    const r = sanitizeStatusline({ theme: 'dark-nord', separator: 'pipe', left: ['git'], ctx: { warnAt: 40 } })
    expect(r.config.theme).toBe('dark-nord')
    expect(r.config.separator).toBe('pipe')
    expect(r.config.left).toEqual(['git'])
    expect(r.config.ctx).toEqual({ warnAt: 40, errorAt: 80 })
  })
  test('wrong types fall back per key with a warning each', () => {
    const r = sanitizeStatusline({ left: 'model', separator: 3, ctx: { warnAt: 'x' } })
    expect(r.config.left).toEqual(schemaDefaults().statusline.left)
    expect(r.config.separator).toBe('powerline-thin')
    expect(r.config.ctx.warnAt).toBe(50)
    expect(r.warnings.length).toBe(3)
  })
  test('unknown and duplicate segment ids are dropped, one warning each', () => {
    const r = sanitizeStatusline({ left: ['model', 'model', 'bogus', 'git'] })
    expect(r.config.left).toEqual(['model', 'git'])
    expect(r.warnings.length).toBe(2)
  })
  test('a segment in both lists stays only in left', () => {
    const r = sanitizeStatusline({ left: ['cost'], right: ['cost', 'ctx'] })
    expect(r.config.right).toEqual(['ctx'])
  })
  test('non-object input → defaults with a warning', () => {
    expect(sanitizeStatusline('nope').warnings.length).toBe(1)
  })
})
