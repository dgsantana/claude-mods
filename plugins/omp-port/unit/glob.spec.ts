import { describe, expect, test } from 'bun:test'
import { globMatches } from '../hooks/glob'

describe('globMatches', () => {
  test('basename globs match anywhere, both separator styles', () => {
    expect(globMatches('*.rs', '/a/b/main.rs')).toBe(true)
    expect(globMatches('*.rs', 'C:\\a\\main.rs')).toBe(true)
    expect(globMatches('*.rs', '/a/main.rsx')).toBe(false)
    expect(globMatches('*_test.go', '/x/foo_test.go')).toBe(true)
    expect(globMatches('*_test.go', '/x/foo.go')).toBe(false)
  })
  test('brace alternatives and ?', () => {
    expect(globMatches('*.{ts,tsx}', '/a/x.tsx')).toBe(true)
    expect(globMatches('*.{ts,tsx}', '/a/x.js')).toBe(false)
    expect(globMatches('?.md', '/a/b.md')).toBe(true)
  })
  test('path globs with ** match against the path tail', () => {
    expect(globMatches('src/**/*.ts', '/repo/src/a/b/c.ts')).toBe(true)
    expect(globMatches('src/**/*.ts', 'C:\\repo\\src\\c.ts')).toBe(true)
    expect(globMatches('src/*.ts', '/repo/src/a/c.ts')).toBe(false)
  })
  test('regex metacharacters in globs are literal', () => {
    expect(globMatches('a+b.(x)', '/q/a+b.(x)')).toBe(true)
    expect(globMatches('a+b.(x)', '/q/aab.(x)')).toBe(false)
  })
})
