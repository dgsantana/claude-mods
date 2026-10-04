// Git branch / dirty / ahead-behind for the status line, cached briefly in the
// OS temp dir so a refresh burst runs `git status` once.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitInfo } from './segments'

const TTL_MS = 2000

export function parsePorcelain(out: string): GitInfo | undefined {
  if (out.trim() === '') return undefined
  let branch = ''
  let oid = ''
  let ahead = 0
  let behind = 0
  let dirty = false
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
    else if (line.startsWith('# branch.head ')) branch = line.slice(14).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      ahead = Number(m?.[1] ?? 0)
      behind = Number(m?.[2] ?? 0)
    } else if (line !== '' && !line.startsWith('#')) dirty = true
  }
  if (branch === '(detached)' || branch === '') branch = oid.slice(0, 7)
  return { branch, dirty, ahead, behind }
}

export function gitInfo(cwd: string): GitInfo | undefined {
  const key = createHash('sha1').update(cwd).digest('hex').slice(0, 16)
  const file = join(tmpdir(), `claude-mods-statusline-${key}.json`)
  try {
    const cached = JSON.parse(readFileSync(file, 'utf8')) as { at: number; info: GitInfo | null }
    if (Date.now() - cached.at < TTL_MS) return cached.info ?? undefined
  } catch {}
  let info: GitInfo | undefined
  try {
    const r = Bun.spawnSync(['git', '-C', cwd, 'status', '--porcelain=v2', '--branch'], { stderr: 'ignore' })
    info = r.exitCode === 0 ? parsePorcelain(r.stdout.toString()) : undefined
  } catch {
    info = undefined
  }
  try {
    writeFileSync(file, JSON.stringify({ at: Date.now(), info: info ?? null }))
  } catch {}
  return info
}
