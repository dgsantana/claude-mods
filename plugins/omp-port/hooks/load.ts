// Discovers the layers on disk through a small Io interface; register.ts
// backs it with the engine (`$` may not cross an import), tests with memory.

import { type Config, mergeAppend, mergeConfig, mergeRules } from './layers'
import { chainBetween, join, samePath } from './paths'
import { type Rule, type RuleSource, ruleFromMarkdown } from './rule'

export type Io = {
  env: (name: 'HOME' | 'USERPROFILE') => Promise<string | undefined>
  read: (path: string) => Promise<string | undefined>
  listMarkdown: (dir: string) => Promise<string[]>
}

export type Layer = { source: RuleSource; dir: string }

export type Snapshot = {
  config: Config
  rules: Rule[]
  append: string
  layers: Layer[]
  warnings: string[]
}

export async function homeDir(io: Io): Promise<string | undefined> {
  return (await io.env('USERPROFILE')) || (await io.env('HOME')) || undefined
}

async function loadRules(io: Io, dir: string, source: RuleSource, warnings: string[]): Promise<Rule[]> {
  const rules: Rule[] = []
  for (const name of await io.listMarkdown(dir)) {
    const path = join(dir, name)
    const text = await io.read(path)
    if (text === undefined) continue
    const rule = ruleFromMarkdown(path, text, source)
    if (rule.warning) warnings.push(`${path}: frontmatter fallback (${rule.warning})`)
    rules.push(rule)
  }
  return rules
}

export async function discover(
  io: Io,
  where: { builtinDir: string; root: string; cwd: string },
): Promise<Snapshot> {
  const warnings: string[] = []
  const home = await homeDir(io)
  const layers: Layer[] = [{ source: 'builtin', dir: where.builtinDir }]
  if (home) layers.push({ source: 'global', dir: join(home, '.agents') })
  for (const dir of chainBetween(where.root, where.cwd)) {
    if (home && samePath(dir, home)) continue
    layers.push({ source: 'project', dir: join(dir, '.agents') })
  }

  const ruleLayers: Rule[][] = []
  const configs: unknown[] = []
  const appends: string[] = []
  for (const layer of layers) {
    if (layer.source === 'builtin') {
      ruleLayers.push(await loadRules(io, layer.dir, 'builtin', warnings))
      continue
    }
    ruleLayers.push(await loadRules(io, join(layer.dir, 'rules'), layer.source, warnings))
    const cfgPath = join(layer.dir, 'mods', 'config.json')
    const cfgText = await io.read(cfgPath)
    if (cfgText !== undefined) {
      try {
        configs.push(JSON.parse(cfgText))
      } catch (err) {
        warnings.push(`${cfgPath}: invalid config.json (${err instanceof Error ? err.message : err})`)
      }
    }
    const append = await io.read(join(layer.dir, 'mods', 'APPEND_SYSTEM.md'))
    if (append !== undefined) appends.push(append)
  }

  const config = mergeConfig(configs)
  return { config, rules: mergeRules(ruleLayers, config), append: mergeAppend(appends), layers, warnings }
}
