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

import { dirname, isWindowsPath, join, chainBetween, samePath } from '../hooks/paths'

describe('join/dirname', () => {
  test('join keeps the separator style of the base', () => {
    expect(join('/home/d', '.agents', 'rules')).toBe('/home/d/.agents/rules')
    expect(join('C:\\Users\\d', '.agents', 'rules')).toBe('C:\\Users\\d\\.agents\\rules')
    expect(join('/home/d/', 'x')).toBe('/home/d/x')
  })
  test('dirname on both styles; root stays root', () => {
    expect(dirname('/a/b/c')).toBe('/a/b')
    expect(dirname('C:\\a\\b')).toBe('C:\\a')
    expect(dirname('/a')).toBe('/')
    expect(dirname('/')).toBe('/')
    expect(dirname('C:\\')).toBe('C:\\')
  })
  test('isWindowsPath', () => {
    expect(isWindowsPath('C:\\x')).toBe(true)
    expect(isWindowsPath('c:/x')).toBe(true)
    expect(isWindowsPath('/x')).toBe(false)
  })
  test('samePath ignores separator style, trailing slash and drive-letter case', () => {
    expect(samePath('C:\\a\\b\\', 'c:/a/b')).toBe(true)
    expect(samePath('/a/b', '/a/c')).toBe(false)
  })
})

describe('chainBetween', () => {
  test('lists dirs from root down to cwd inclusive', () => {
    expect(chainBetween('/r', '/r/a/b')).toEqual(['/r', '/r/a', '/r/a/b'])
    expect(chainBetween('C:\\r', 'C:\\r\\a')).toEqual(['C:\\r', 'C:\\r\\a'])
  })
  test('cwd outside root yields cwd only', () => {
    expect(chainBetween('/r', '/elsewhere/x')).toEqual(['/elsewhere/x'])
  })
  test('cwd equal to root yields root', () => {
    expect(chainBetween('/r', '/r')).toEqual(['/r'])
  })
})
