// omp's Rule shape, built from one Markdown rule file.

import { parseFrontmatter } from './frontmatter'
import { basename } from './paths'

export type RuleSource = 'builtin' | 'global' | 'project'
export type InterruptMode = 'never' | 'prose-only' | 'tool-only' | 'always'

export type Rule = {
  name: string
  path: string
  content: string
  source: RuleSource
  enabled: boolean
  description?: string
  globs?: string[]
  alwaysApply?: boolean
  condition?: string[]
  astCondition?: string[]
  scope?: string[]
  interruptMode?: InterruptMode
  warning?: string
}

const INTERRUPT_MODES: readonly string[] = ['never', 'prose-only', 'tool-only', 'always']

function toList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined
  const list = (Array.isArray(v) ? v : [v]).filter((x): x is string | number => typeof x === 'string' || typeof x === 'number')
  const out = list.map(String).filter(s => s !== '')
  return out.length > 0 ? out : undefined
}

// Splits on commas outside (), {} and quotes; strips stray quotes from the
// malformed `"text","thinking"` fallback spelling.
function splitScope(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of s) {
    if (c === '(' || c === '{') depth++
    if (c === ')' || c === '}') depth--
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map(t => t.trim().replace(/^["']|["']$/g, '').trim()).filter(t => t !== '')
}

export function ruleFromMarkdown(path: string, text: string, source: RuleSource): Rule {
  const { data, body, warning } = parseFrontmatter(text)
  const name = basename(path).replace(/\.mdc?$/i, '')
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

  const rawScope = toList(data.scope)
  const scope = rawScope?.flatMap(splitScope)
  const interrupt = str(data.interruptMode)

  const rule: Rule = {
    name,
    path,
    content: body,
    source,
    enabled: data.enabled !== false,
    description: str(data.description),
    globs: toList(data.globs),
    alwaysApply: data.alwaysApply === true ? true : undefined,
    condition: toList(data.condition) ?? toList(data.ttsr_trigger) ?? toList(data.ttsrTrigger),
    astCondition: toList(data.astCondition),
    scope: scope && scope.length > 0 ? scope : undefined,
    interruptMode: interrupt && INTERRUPT_MODES.includes(interrupt) ? (interrupt as InterruptMode) : undefined,
    warning,
  }
  for (const k of Object.keys(rule) as (keyof Rule)[]) if (rule[k] === undefined) delete rule[k]
  return rule
}
