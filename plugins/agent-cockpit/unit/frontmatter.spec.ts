import { describe, expect, test } from 'bun:test'
import { parseFrontmatter } from '../hooks/frontmatter'

describe('parseFrontmatter', () => {
  test('parses plain, quoted and boolean scalars', () => {
    const r = parseFrontmatter('---\ndescription: hello world\nname: "quoted: x"\nalwaysApply: true\nenabled: false\n---\nBody')
    expect(r.data).toEqual({ description: 'hello world', name: 'quoted: x', alwaysApply: true, enabled: false })
    expect(r.body).toBe('Body')
    expect(r.warning).toBeUndefined()
  })

  test('parses flow arrays with mixed quoting', () => {
    const r = parseFrontmatter('---\nscope: [text, "tool:edit(*.rs)", \'b, c\']\n---\n')
    expect(r.data.scope).toEqual(['text', 'tool:edit(*.rs)', 'b, c'])
  })

  test('parses block sequences and ignores comments', () => {
    const r = parseFrontmatter('---\n# comment\nastCondition:\n  - "for $I := 0; $I < $N; $I++ { $$$BODY }"\n  - foo # trailing\n---\nx')
    expect(r.data.astCondition).toEqual(['for $I := 0; $I < $N; $I++ { $$$BODY }', 'foo'])
  })

  test('camel-cases hyphenated keys', () => {
    expect(parseFrontmatter('---\ninterrupt-mode: never\n---\n').data).toEqual({ interruptMode: 'never' })
  })

  test('single-quoted strings unescape doubled quotes; double-quoted handle escapes', () => {
    const r = parseFrontmatter(`---\na: 'it''s'\nb: "x\\"y\\\\z"\n---\n`)
    expect(r.data).toEqual({ a: "it's", b: 'x"y\\z' })
  })

  test('no frontmatter returns empty data and full body', () => {
    expect(parseFrontmatter('# Title\ntext')).toEqual({ data: {}, body: '# Title\ntext' })
  })

  test('unclosed frontmatter is treated as body', () => {
    const r = parseFrontmatter('---\na: 1\nno close')
    expect(r.data).toEqual({})
    expect(r.body).toBe('---\na: 1\nno close')
  })

  test('invalid YAML falls back to key: value lines with a warning', () => {
    const r = parseFrontmatter('---\nscope: "text","thinking"\ndescription: ok\n  bad: [unclosed\n---\nB')
    expect(r.warning).toBeDefined()
    expect(r.data.description).toBe('ok')
    expect(r.data.scope).toBe('"text","thinking"')
    expect(r.body).toBe('B')
  })

  test('handles CRLF line endings', () => {
    const r = parseFrontmatter('---\r\ndescription: win\r\n---\r\nBody\r\n')
    expect(r.data).toEqual({ description: 'win' })
    expect(r.body).toBe('Body')
  })
})

describe('review fixes', () => {
  test('block sequence items at column 0 belong to the key above', () => {
    const r = parseFrontmatter('---\ncondition: x\nglobs:\n- "*.rs"\n- "*.toml"\n---\nB')
    expect(r.warning).toBeUndefined()
    expect(r.data.globs).toEqual(['*.rs', '*.toml'])
  })
  test('a leading UTF-8 BOM does not hide the frontmatter', () => {
    const r = parseFrontmatter('﻿---\ndescription: bom\n---\nB')
    expect(r.data).toEqual({ description: 'bom' })
    expect(r.body).toBe('B')
  })
})
