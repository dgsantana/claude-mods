// Loads the status line's layered config and theme from disk (Node), cached
// in the OS temp dir until a config.json or themes folder changes.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { discover, type Io, layerDirs } from '../plugins/omp-port/hooks/load'
import { sanitizeStatusline, type StatuslineConfig } from '../plugins/omp-port/hooks/statusline-config'
import { type ResolvedTheme, resolveTheme } from '../plugins/omp-port/hooks/themes'
import type { StatusInput } from './segments'

const PLUGIN = join(import.meta.dir, '..', 'plugins', 'omp-port')
const BUILTIN = JSON.parse(readFileSync(join(PLUGIN, 'themes', 'builtin.json'), 'utf8')) as Record<string, Record<string, string>>

export type Loaded = { config: StatuslineConfig; theme: ResolvedTheme; warnings: string[] }

const nodeIo = (env: Record<string, string | undefined>): Io => ({
  env: async name => env[name],
  read: async path => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
  // Rules aren't needed here; only theme files are listed.
  listFiles: async (dir, ext) => {
    if (ext !== '.json') return []
    try {
      return readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json')).sort()
    } catch {
      return []
    }
  },
})

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

// The repository root above `dir` (the nearest ancestor holding .git), so a
// session started in a subfolder still reads the repo root's .agents.
function gitRoot(dir: string): string | undefined {
  let cur = dir
  for (;;) {
    if (existsSync(join(cur, '.git'))) return cur
    const up = dirname(cur)
    if (up === cur) return undefined
    cur = up
  }
}

// Each theme file's name and mtime: editing a file in place doesn't change
// its folder's mtime.
function themeStamps(dir: string): string {
  try {
    return readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith('.json'))
      .sort()
      .map(f => `${f}@${mtime(join(dir, f))}`)
      .join(',')
  } catch {
    return ''
  }
}

async function load(root: string, cwd: string, env: Record<string, string | undefined>): Promise<Loaded> {
  const snap = await discover(nodeIo(env), { builtinDir: join(PLUGIN, 'no-rules'), root, cwd })
  const { config, warnings } = sanitizeStatusline(snap.config.statusline)
  const resolved = resolveTheme(config.theme, BUILTIN, snap.themeSpecs)
  return { config, theme: resolved.theme, warnings: [...snap.warnings, ...warnings, ...resolved.warnings] }
}

export async function loadStatusline(
  input: StatusInput,
  env: Record<string, string | undefined> = process.env,
  cacheDir: string = tmpdir(),
): Promise<Loaded> {
  const cwd = input.workspace?.current_dir ?? input.cwd ?? process.cwd()
  const launch = input.workspace?.project_dir ?? cwd
  const root = gitRoot(launch) ?? launch
  const home = env.USERPROFILE || env.HOME || homedir()
  const dirs = layerDirs(home, root, cwd).map(l => l.dir)
  const signature = dirs.map(d => `${d}:${mtime(join(d, 'mods', 'config.json'))}:${themeStamps(join(d, 'mods', 'themes'))}`).join('|')
  const file = join(cacheDir, `claude-mods-statusline-cfg-${createHash('sha1').update(dirs.join('|')).digest('hex').slice(0, 16)}.json`)
  try {
    if (existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, 'utf8')) as { signature: string; loaded: Loaded }
      // Re-sanitised so a cache written by an older version can't miss keys.
      if (cached.signature === signature) return { ...cached.loaded, config: sanitizeStatusline(cached.loaded.config).config }
    }
  } catch {}
  let loaded: Loaded
  try {
    loaded = await load(root, cwd, { ...env, HOME: env.HOME ?? home })
  } catch {
    loaded = { config: sanitizeStatusline(undefined).config, theme: resolveTheme('dark', BUILTIN, {}).theme, warnings: [] }
  }
  try {
    writeFileSync(file, JSON.stringify({ signature, loaded }))
  } catch {}
  return loaded
}
