import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Rule } from '../hooks/rule'
import { ruleFromMarkdown } from '../hooks/rule'
import {
  MAX_SCAN_CHARS,
  astTargets,
  compileRule,
  extractCandidates,
  isEligible,
  langFromPath,
  markInjected,
  matchRegex,
  newRepeatState,
  onTurnEnd,
  renderReminder,
} from '../hooks/ttsr-match'

const r = (extra: Partial<Rule>): Rule => ({ name: 'r', path: '/r.md', content: 'Body', source: 'global', enabled: true, ...extra })
const builtin = (name: string) => {
  const p = join(import.meta.dir, '..', 'builtin-rules', `${name}.md`)
  return ruleFromMarkdown(p, readFileSync(p, 'utf8'), 'builtin')
}

describe('compileRule', () => {
  test('tool:edit(*.rs) matches Edit on .rs (both separators) but not Write', () => {
    const c = compileRule(r({ condition: ['Box::leak'], scope: ['tool:edit(*.rs)'] }))!
    expect(matchRegex([c], { tool: 'Edit', path: 'src/main.rs', text: 'Box::leak(x)' })).toHaveLength(1)
    expect(matchRegex([c], { tool: 'Edit', path: 'C:\\p\\main.rs', text: 'Box::leak(x)' })).toHaveLength(1)
    expect(matchRegex([c], { tool: 'Write', path: 'src/main.rs', text: 'Box::leak(x)' })).toHaveLength(0)
    expect(matchRegex([c], { tool: 'Edit', path: 'src/main.go', text: 'Box::leak(x)' })).toHaveLength(0)
  })
  test('tool:write(*.rs) matches Write', () => {
    const c = compileRule(r({ condition: ['x'], scope: ['tool:write(*.rs)'] }))!
    expect(matchRegex([c], { tool: 'Write', path: 'a.rs', text: 'x' })).toHaveLength(1)
  })
  test('bare tool / toolcall scope matches any tool and any path', () => {
    for (const s of ['tool', 'toolcall']) {
      const c = compileRule(r({ condition: ['x'], scope: [s] }))!
      expect(matchRegex([c], { tool: 'Write', path: 'a.md', text: 'x' })).toHaveLength(1)
    }
  })
  test('no scope means text + tool, so tools are watched', () => {
    const c = compileRule(r({ condition: ['x'] }))!
    expect(matchRegex([c], { tool: 'Edit', path: 'a', text: 'x' })).toHaveLength(1)
  })
  test('text/thinking-only scopes are not compiled', () => {
    expect(compileRule(r({ condition: ['x'], scope: ['text', 'thinking'] }))).toBeUndefined()
  })
  test('rules without triggers are not compiled', () => {
    expect(compileRule(r({ description: 'd' }))).toBeUndefined()
  })
  test('glob-looking condition becomes edit/write scope with catch-all', () => {
    const c = compileRule(r({ condition: ['*.sql'] }))!
    expect(matchRegex([c], { tool: 'Write', path: '/q/a.sql', text: 'anything' })).toHaveLength(1)
    expect(matchRegex([c], { tool: 'Edit', path: '/q/a.sql', text: 'anything' })).toHaveLength(1)
    expect(matchRegex([c], { tool: 'Edit', path: '/q/a.ts', text: 'anything' })).toHaveLength(0)
  })
  test('inline (?i) flag maps to JS flags', () => {
    const c = compileRule(r({ condition: ['(?i)todo'] }))!
    expect(matchRegex([c], { tool: 'Edit', path: 'a', text: 'TODO: x' })).toHaveLength(1)
  })
  test('invalid regex is skipped, other conditions kept', () => {
    const c = compileRule(r({ condition: ['(unclosed', 'ok'] }))!
    expect(c.warnings[0]).toContain('(unclosed')
    expect(matchRegex([c], { tool: 'Edit', path: 'a', text: 'ok' })).toHaveLength(1)
  })
  test('only invalid regex and no AST → not compiled', () => {
    expect(compileRule(r({ condition: ['(unclosed'] }))).toBeUndefined()
  })
  test('globs gate the candidate path', () => {
    const c = compileRule(r({ condition: ['x'], globs: ['*.ts'] }))!
    expect(matchRegex([c], { tool: 'Edit', path: 'a.ts', text: 'x' })).toHaveLength(1)
    expect(matchRegex([c], { tool: 'Edit', path: 'a.rs', text: 'x' })).toHaveLength(0)
  })
  test('regex scan is capped at MAX_SCAN_CHARS', () => {
    const c = compileRule(r({ condition: ['NEEDLE'] }))!
    const text = 'a'.repeat(MAX_SCAN_CHARS) + 'NEEDLE'
    expect(matchRegex([c], { tool: 'Write', path: 'a', text })).toHaveLength(0)
  })
  test('vendored rs-box-leak and ts-bare-catch compile and fire', () => {
    const box = compileRule(builtin('rs-box-leak'))!
    expect(matchRegex([box], { tool: 'Edit', path: 'lib.rs', text: 'Box::leak(Box::new(1))' })).toHaveLength(1)
    const ts = compileRule(builtin('ts-bare-catch'))!
    expect(matchRegex([ts], { tool: 'Write', path: 'a.ts', text: 'try {} catch (_e) {}' })).toHaveLength(1)
  })
})

describe('astTargets', () => {
  test('AST rules yield patterns with language from the path', () => {
    const c = compileRule(builtin('go-range-int'))!
    const t = astTargets([c], { tool: 'Edit', path: 'x/main.go', text: 'for i := 0; i < n; i++ {}' })
    expect(t).toHaveLength(1)
    expect(t[0]!.lang).toBe('go')
    expect(t[0]!.patterns[0]).toContain('for $I := 0')
  })
  test('unknown extension yields no AST target', () => {
    const c = compileRule(r({ astCondition: ['foo($A)'] }))!
    expect(astTargets([c], { tool: 'Edit', path: 'x.unknownext', text: 'foo(1)' })).toHaveLength(0)
  })
  test('langFromPath', () => {
    expect(langFromPath('a.rs')).toBe('rust')
    expect(langFromPath('C:\\a\\b.tsx')).toBe('tsx')
    expect(langFromPath('a.ts')).toBe('typescript')
    expect(langFromPath('a.py')).toBe('python')
    expect(langFromPath('Makefile')).toBeUndefined()
  })
})

describe('extractCandidates', () => {
  test('Edit uses new_string; Write uses content', () => {
    expect(extractCandidates('Edit', { file_path: '/a.rs', old_string: 'o', new_string: 'n' })).toEqual([
      { tool: 'Edit', path: '/a.rs', text: 'n' },
    ])
    expect(extractCandidates('Write', { file_path: '/a.rs', content: 'c' })).toEqual([
      { tool: 'Write', path: '/a.rs', text: 'c' },
    ])
  })
  test('other tools and malformed input yield nothing', () => {
    expect(extractCandidates('Bash', { command: 'x' })).toEqual([])
    expect(extractCandidates('Edit', { file_path: 3 })).toEqual([])
    expect(extractCandidates('Write', null)).toEqual([])
  })
})

describe('repeat policy', () => {
  test('once: eligible until injected', () => {
    const s = newRepeatState()
    expect(isEligible(s, 'a', 'once', 10)).toBe(true)
    markInjected(s, 'a')
    onTurnEnd(s)
    onTurnEnd(s)
    expect(isEligible(s, 'a', 'once', 10)).toBe(false)
  })
  test('after-gap: eligible again after gap completed turns', () => {
    const s = newRepeatState()
    markInjected(s, 'a')
    onTurnEnd(s)
    expect(isEligible(s, 'a', 'after-gap', 2)).toBe(false)
    onTurnEnd(s)
    expect(isEligible(s, 'a', 'after-gap', 2)).toBe(true)
  })
})

describe('renderReminder', () => {
  test('wraps the body with rule name and path', () => {
    const out = renderReminder(r({ name: 'rs-box-leak', content: 'Never leak.' }), '/a/lib.rs')
    expect(out).toBe('<system-reminder reason="rule_violation" rule="rs-box-leak" path="/a/lib.rs">\nNever leak.\n</system-reminder>')
  })
  test('escapes quotes in attributes', () => {
    expect(renderReminder(r({ name: 'a"b' }), 'p"q')).toContain('rule="a&quot;b" path="p&quot;q"')
  })
})
