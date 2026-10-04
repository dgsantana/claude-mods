import { describe, expect, test } from 'bun:test'
import { DEFAULT_CONFIG } from '../hooks/layers'
import { SETTINGS, schemaDefaults, settingsFor, validate, type Setting } from '../hooks/settings-schema'

const byKey = (k: string) => SETTINGS.find(s => s.key === k) as Setting

describe('catalogue', () => {
  test('spec settings with spec defaults', () => {
    const expected: Record<string, unknown> = {
      'statusline.theme': 'dark',
      'statusline.separator': 'powerline-thin',
      'statusline.icons': 'nerd',
      'statusline.left': ['model', 'caveman', 'mode', 'path', 'git', 'pr'],
      'statusline.right': ['session', 'tokens', 'cost', 'fiveHour', 'ctx'],
      'statusline.path.style': 'basename',
      'statusline.git.aheadBehind': true,
      'statusline.fiveHour.showReset': true,
      'statusline.ctx.warnAt': 50,
      'statusline.ctx.errorAt': 80,
      'ttsr.enabled': true,
      'ttsr.interruptMode': 'always',
      'ttsr.repeatMode': 'once',
      'ttsr.repeatGap': 10,
      'rules.builtin': true,
      'rules.disabled': [],
      'append.enabled': true,
      'agentsMd.enabled': true,
      'advisor.enabled': false,
    }
    for (const [k, v] of Object.entries(expected)) expect(byKey(k)?.default).toEqual(v)
  })
  test('every tab has rows; keys unique', () => {
    for (const t of ['statusline', 'ttsr', 'rules', 'advisor', 'context'] as const) expect(settingsFor(t).length).toBeGreaterThan(0)
    expect(new Set(SETTINGS.map(s => s.key)).size).toBe(SETTINGS.length)
  })
  test('advisor enabled/model/budget are store-backed', () => {
    for (const k of ['advisor.enabled', 'advisor.model', 'advisor.budgetUsd']) expect(byKey(k).storage).toBe('store')
  })
  test('DEFAULT_CONFIG is built from schema defaults', () => {
    const d = schemaDefaults()
    expect(DEFAULT_CONFIG.statusline).toEqual(d.statusline)
    expect(DEFAULT_CONFIG.ttsr).toEqual(d.ttsr)
    expect(DEFAULT_CONFIG.rules).toEqual(d.rules)
    expect(DEFAULT_CONFIG.append).toEqual(d.append)
    expect(DEFAULT_CONFIG.agentsMd).toEqual(d.agentsMd)
    expect(DEFAULT_CONFIG.advisor).toEqual({ enabled: false, prices: {} })
  })
})

describe('validate', () => {
  test('enum', () => {
    expect(validate(byKey('statusline.separator'), 'pipe')).toEqual({ value: 'pipe' })
    expect('error' in validate(byKey('statusline.separator'), 'zigzag')).toBe(true)
  })
  test('number bounds and numeric strings', () => {
    expect(validate(byKey('statusline.ctx.warnAt'), '60')).toEqual({ value: 60 })
    expect('error' in validate(byKey('statusline.ctx.warnAt'), 150)).toBe(true)
    expect('error' in validate(byKey('ttsr.repeatGap'), 'abc')).toBe(true)
    expect('error' in validate(byKey('ttsr.repeatGap'), 0)).toBe(true)
  })
  test('bool', () => {
    expect(validate(byKey('ttsr.enabled'), false)).toEqual({ value: false })
    expect('error' in validate(byKey('ttsr.enabled'), 'yes')).toBe(true)
  })
  test('segments reject unknown and duplicate ids', () => {
    expect(validate(byKey('statusline.left'), ['model', 'git'])).toEqual({ value: ['model', 'git'] })
    expect('error' in validate(byKey('statusline.left'), ['model', 'bogus'])).toBe(true)
    expect('error' in validate(byKey('statusline.left'), ['model', 'model'])).toBe(true)
    expect('error' in validate(byKey('statusline.left'), 'model')).toBe(true)
  })
  test('stringList and theme', () => {
    expect(validate(byKey('rules.disabled'), ['a'])).toEqual({ value: ['a'] })
    expect('error' in validate(byKey('rules.disabled'), [1])).toBe(true)
    expect('error' in validate(byKey('statusline.theme'), '')).toBe(true)
  })
})
