// TTSR in tool scope: which compiled rules fire on an Edit/Write payload, the
// repeat policy, and the reminder text. Pure; register.ts runs it.

import { globMatches } from './glob'
import { basename } from './paths'
import type { Rule } from './rule'

export const MAX_SCAN_CHARS = 512 * 1024

export type Candidate = { tool: string; path: string; text: string }

// omp names the tools `edit` and `write`; Claude Code's are `Edit` and `Write`.
type ToolScope = { tool: string | undefined; glob?: string }

export type CompiledRule = {
  rule: Rule
  regexes: RegExp[]
  ast: string[]
  tools: ToolScope[]
  warnings: string[]
}

const OMP_TOOL: Record<string, string> = { edit: 'Edit', write: 'Write' }

// omp's heuristic for a condition that is really a file glob (`*.rs`).
function isLikelyFileGlob(value: string): boolean {
  const t = value.trim()
  if (t === '' || /[\\^$+|()]/.test(t) || !/[?*[\]{}]/.test(t)) return false
  return t.includes('/') || /^\*\.[^\s/]+$/.test(t)
}

function toRegExp(src: string): RegExp {
  let flags = ''
  let body = src
  const m = /^\(\?([ims]+)\)/.exec(body)
  if (m) {
    flags = [...new Set(m[1])].join('')
    body = body.slice(m[0].length)
  }
  return new RegExp(body, flags)
}

function parseScope(tokens: readonly string[]): ToolScope[] {
  const out: ToolScope[] = []
  for (const raw of tokens) {
    const t = raw.trim()
    if (t === 'tool' || t === 'toolcall') {
      out.push({ tool: undefined })
      continue
    }
    const m = /^tool:([\w-]+)(?:\((.*)\))?$/.exec(t)
    if (!m) continue
    const name = m[1] ?? ''
    out.push({ tool: OMP_TOOL[name.toLowerCase()] ?? name, glob: m[2] || undefined })
  }
  return out
}

export function compileRule(rule: Rule): CompiledRule | undefined {
  const warnings: string[] = []
  const regexes: RegExp[] = []
  const inferred: string[] = []
  const conditions: string[] = []
  for (const c of rule.condition ?? []) {
    if (isLikelyFileGlob(c)) inferred.push(`tool:edit(${c})`, `tool:write(${c})`)
    else conditions.push(c)
  }
  if (conditions.length === 0 && inferred.length > 0) conditions.push('.*')
  for (const c of conditions) {
    try {
      regexes.push(toRegExp(c))
    } catch {
      warnings.push(`${rule.name}: invalid condition ${c}`)
    }
  }
  const ast = rule.astCondition ?? []
  if (regexes.length === 0 && ast.length === 0) return undefined

  const scopeTokens = [...(rule.scope ?? []), ...inferred]
  const tools = scopeTokens.length === 0 ? [{ tool: undefined }] : parseScope(scopeTokens)
  if (tools.length === 0) return undefined
  return { rule, regexes, ast, tools, warnings }
}

function inScope(c: CompiledRule, cand: Candidate): boolean {
  if (c.rule.globs?.length && !c.rule.globs.some(g => globMatches(g, cand.path))) return false
  return c.tools.some(s => (s.tool === undefined || s.tool === cand.tool) && (!s.glob || globMatches(s.glob, cand.path)))
}

export function matchRegex(rules: readonly CompiledRule[], cand: Candidate): CompiledRule[] {
  const text = cand.text.length > MAX_SCAN_CHARS ? cand.text.slice(0, MAX_SCAN_CHARS) : cand.text
  return rules.filter(c => c.regexes.length > 0 && inScope(c, cand) && c.regexes.some(re => re.test(text)))
}

const LANGS: Record<string, string> = {
  rs: 'rust', go: 'go', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', py: 'python',
  java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', swift: 'swift', lua: 'lua', php: 'php', scala: 'scala', ex: 'elixir', hs: 'haskell',
}

export function langFromPath(path: string): string | undefined {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? LANGS[name.slice(dot + 1).toLowerCase()] : undefined
}

export function astTargets(
  rules: readonly CompiledRule[],
  cand: Candidate,
): { rule: CompiledRule; patterns: string[]; lang: string }[] {
  const lang = langFromPath(cand.path)
  if (!lang) return []
  return rules.filter(c => c.ast.length > 0 && inScope(c, cand)).map(c => ({ rule: c, patterns: c.ast, lang }))
}

export function extractCandidates(tool: string, input: unknown): Candidate[] {
  if (typeof input !== 'object' || input === null) return []
  const i = input as Record<string, unknown>
  if (typeof i.file_path !== 'string') return []
  if (tool === 'Edit' && typeof i.new_string === 'string') return [{ tool, path: i.file_path, text: i.new_string }]
  if (tool === 'Write' && typeof i.content === 'string') return [{ tool, path: i.file_path, text: i.content }]
  return []
}

// Repeat policy, measured in completed turns like omp's.
export type RepeatState = { turn: number; injectedAt: Record<string, number> }

export const newRepeatState = (): RepeatState => ({ turn: 0, injectedAt: {} })

export function isEligible(s: RepeatState, name: string, mode: 'once' | 'after-gap', gap: number): boolean {
  const at = s.injectedAt[name]
  if (at === undefined) return true
  return mode === 'after-gap' && s.turn - at >= gap
}

export function markInjected(s: RepeatState, name: string): void {
  s.injectedAt[name] = s.turn
}

export function onTurnEnd(s: RepeatState): void {
  s.turn++
}

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

export function renderReminder(rule: Rule, path: string): string {
  return `<system-reminder reason="rule_violation" rule="${attr(rule.name)}" path="${attr(path)}">\n${rule.content}\n</system-reminder>`
}
