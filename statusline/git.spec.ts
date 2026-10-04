import { describe, expect, test } from 'bun:test'
import { parsePorcelain } from './git'

describe('parsePorcelain', () => {
  test('branch, ahead/behind and dirty from porcelain v2 output', () => {
    const out = '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b file.ts\n'
    expect(parsePorcelain(out)).toEqual({ branch: 'main', dirty: true, ahead: 2, behind: 1 })
  })
  test('clean detached head', () => {
    expect(parsePorcelain('# branch.oid abcdef1234\n# branch.head (detached)\n')).toEqual({ branch: 'abcdef1', dirty: false, ahead: 0, behind: 0 })
  })
  test('empty output → undefined', () => {
    expect(parsePorcelain('')).toBeUndefined()
  })
})
