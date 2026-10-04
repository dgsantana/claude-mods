// Caveman mode badge, read the way caveman's own statusline script reads it:
// flag file in the Claude config dir, symlinks refused, 64-byte cap, a
// whitelist of modes, control bytes stripped from the savings suffix.

import { lstatSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Caveman = { mode: string; savings?: string }

const MODES = new Set([
  'off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra', 'commit', 'review', 'compress',
])

function readCapped(path: string): string | undefined {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink() || !st.isFile()) return undefined
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.alloc(64)
      const n = readSync(fd, buf, 0, 64, 0)
      return buf.subarray(0, n).toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

export function cavemanDir(env: Record<string, string | undefined>): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

export function readCaveman(dir: string, env: Record<string, string | undefined>): Caveman | undefined {
  const raw = readCapped(join(dir, '.caveman-active'))
  if (raw === undefined) return undefined
  const mode = raw.replace(/[\r\n]/g, '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!MODES.has(mode) || mode === 'off') return undefined
  const out: Caveman = { mode: mode === 'full' ? '' : mode.toUpperCase() }
  if (env.CAVEMAN_STATUSLINE_SAVINGS !== '0') {
    const s = readCapped(join(dir, '.caveman-statusline-suffix'))?.replace(/[\x00-\x1f\x7f]/g, '').trim()
    if (s) out.savings = s
  }
  return out
}
