import { describe, expect, test } from 'bun:test'
import { buildCommand, patchSettings } from './install'

describe('buildCommand', () => {
  test('forward slashes and quoting so Git Bash on Windows keeps the path', () => {
    expect(buildCommand('C:\\Users\\u\\claude-mods\\statusline\\statusline.ts')).toBe('bun "C:/Users/u/claude-mods/statusline/statusline.ts"')
    expect(buildCommand('/home/u/m/statusline/statusline.ts')).toBe('bun "/home/u/m/statusline/statusline.ts"')
  })
})

describe('patchSettings', () => {
  test('sets statusLine and keeps other keys', () => {
    const out = JSON.parse(patchSettings('{"model":"opus","statusLine":{"type":"command","command":"old"}}', 'bun "x"'))
    expect(out).toEqual({ model: 'opus', statusLine: { type: 'command', command: 'bun "x"', padding: 0 } })
  })
  test('empty or missing settings', () => {
    expect(JSON.parse(patchSettings('', 'c')).statusLine.command).toBe('c')
  })
  test('invalid JSON throws instead of clobbering', () => {
    expect(() => patchSettings('{nope', 'c')).toThrow()
  })
})
