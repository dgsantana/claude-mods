// AGENTS.md as instruction files beside CLAUDE.md: the global
// ~/.agents/AGENTS.md, then every AGENTS.md from the root down to the cwd.

import type { FsAncestor, InstructionFile, PromptContextResult } from 'claude-code'
import { join, samePath } from './paths'

export function addAgentsMd(
  result: PromptContextResult,
  found: readonly FsAncestor[],
  global?: { path: string; content: string },
): PromptContextResult {
  if (result.instructionFiles === undefined) return result
  const files: InstructionFile[] = [...result.instructionFiles]
  const has = (path: string) => files.some(f => samePath(f.path, path))
  if (global && !has(global.path)) files.push({ path: global.path, kind: 'user', content: global.content })
  for (const a of found) {
    const path = join(a.dir, a.name)
    if (!has(path)) files.push({ path, kind: 'project', content: a.content })
  }
  return files.length === result.instructionFiles.length ? result : { ...result, instructionFiles: files }
}
