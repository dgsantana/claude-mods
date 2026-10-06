// The rules section of the system prompt: always-apply bodies in full, then
// the rulebook (rules with a description) as an index the model reads from.

import type { Rule } from './rule'

const isTrigger = (r: Rule) => (r.condition?.length ?? 0) > 0 || (r.astCondition?.length ?? 0) > 0

export function renderRulesSection(rules: readonly Rule[]): string | undefined {
  const always = rules.filter(r => !isTrigger(r) && r.alwaysApply)
  const book = rules.filter(r => !isTrigger(r) && !r.alwaysApply && r.description)
  if (always.length === 0 && book.length === 0) return undefined

  const parts: string[] = []
  if (always.length > 0) {
    parts.push('# Rules', ...always.map(r => `## ${r.name}\n\n${r.content}`))
  }
  if (book.length > 0) {
    const lines = book.map(r => {
      const globs = r.globs?.length ? ` (${r.globs.join(', ')})` : ''
      return `- ${r.name}${globs}: ${r.description} → ${r.path}`
    })
    parts.push(
      '# Rulebook\n\nDomain rules. Before working on something a rule covers, Read its file.\n\n' + lines.join('\n'),
    )
  }
  return parts.join('\n\n')
}
