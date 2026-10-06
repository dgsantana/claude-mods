import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ruleFromMarkdown } from '../hooks/rule'

const md = (fm: string, body = 'Body') => `---\n${fm}\n---\n${body}`

describe('ruleFromMarkdown', () => {
  test('name comes from basename without .md/.mdc for POSIX and Windows paths', () => {
    expect(ruleFromMarkdown('/a/b/no-any.md', 'x', 'global').name).toBe('no-any')
    expect(ruleFromMarkdown('C:\\Users\\d\\.agents\\rules\\rs-x.mdc', 'x', 'project').name).toBe('rs-x')
  })

  test('copies path, source and trimmed body', () => {
    const r = ruleFromMarkdown('/r/a.md', md('description: d', '\n  text  \n'), 'project')
    expect(r).toMatchObject({ path: '/r/a.md', source: 'project', content: 'text', description: 'd', enabled: true })
  })

  test('legacy ttsr_trigger maps to condition list', () => {
    expect(ruleFromMarkdown('/a.md', md('ttsr_trigger: "Box::leak"'), 'global').condition).toEqual(['Box::leak'])
    expect(ruleFromMarkdown('/a.md', md('ttsrTrigger: x'), 'global').condition).toEqual(['x'])
  })

  test('condition wins over legacy trigger', () => {
    expect(ruleFromMarkdown('/a.md', md('condition: a\nttsr_trigger: b'), 'global').condition).toEqual(['a'])
  })

  test('scalar string fields normalise to lists', () => {
    const r = ruleFromMarkdown('/a.md', md('globs: "*.rs"\nastCondition: "foo($A)"'), 'global')
    expect(r.globs).toEqual(['*.rs'])
    expect(r.astCondition).toEqual(['foo($A)'])
  })

  test('comma-separated scope splits; tolerant "a","b" form splits', () => {
    expect(ruleFromMarkdown('/a.md', md('scope: "tool:edit(*.ts), tool:write(*.ts)"'), 'global').scope).toEqual([
      'tool:edit(*.ts)',
      'tool:write(*.ts)',
    ])
    expect(ruleFromMarkdown('/a.md', md('scope: "text","thinking"'), 'global').scope).toEqual(['text', 'thinking'])
  })

  test('scope commas inside parentheses are kept', () => {
    expect(ruleFromMarkdown('/a.md', md('scope: "tool:edit({*.ts,*.tsx}), text"'), 'global').scope).toEqual([
      'tool:edit({*.ts,*.tsx})',
      'text',
    ])
  })

  test('condition list is not comma-split', () => {
    expect(ruleFromMarkdown('/a.md', md('condition: "a, b"'), 'global').condition).toEqual(['a, b'])
  })

  test('enabled false and invalid interruptMode', () => {
    const r = ruleFromMarkdown('/a.md', md('enabled: false\ninterruptMode: sometimes'), 'global')
    expect(r.enabled).toBe(false)
    expect(r.interruptMode).toBeUndefined()
  })

  test('no frontmatter loads as a plain rule', () => {
    expect(ruleFromMarkdown('/a.md', 'just text', 'global')).toMatchObject({ name: 'a', content: 'just text', enabled: true })
  })

  test('every vendored builtin parses without warning and has a trigger', () => {
    const dir = join(import.meta.dir, '..', 'builtin-rules')
    const files = readdirSync(dir).filter(f => f.endsWith('.md'))
    expect(files.length).toBe(27)
    for (const f of files) {
      const r = ruleFromMarkdown(join(dir, f), readFileSync(join(dir, f), 'utf8'), 'builtin')
      expect(r.warning).toBeUndefined()
      expect((r.condition?.length ?? 0) + (r.astCondition?.length ?? 0)).toBeGreaterThan(0)
      expect(r.scope?.length).toBeGreaterThan(0)
    }
  })
})
