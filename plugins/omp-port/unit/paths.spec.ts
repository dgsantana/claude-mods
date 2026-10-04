import { describe, expect, test } from 'bun:test'
import { basename } from '../hooks/paths'

describe('basename', () => {
  test('handles POSIX, Windows and mixed separators', () => {
    expect(basename('/a/b/c.md')).toBe('c.md')
    expect(basename('C:\\a\\b\\c.md')).toBe('c.md')
    expect(basename('C:\\a/b\\c.md')).toBe('c.md')
    expect(basename('c.md')).toBe('c.md')
    expect(basename('/a/b/')).toBe('b')
  })
})
