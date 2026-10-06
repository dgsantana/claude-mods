// Discovers the layers on disk through a small Io interface; register.ts
// backs it with the engine (`$` may not cross an import), tests with memory.

import { type Config, mergeAppend, mergeConfig, mergeRules } from './layers'
import { chainBetween, join, samePath } from './paths'
import { type Rule, type RuleSource, ruleFromMarkdown } from './rule'
import type { ThemeSpec } from './themes'

export type Io = {
  env: (name: 'HOME' | 'USERPROFILE') => Promise<string | undefined>
  read: (path: string) => Promise<string | undefined>
  listFiles: (dir: string, ext: '.md' | '.json') => Promise<string[]>
}

export type Layer = { source: RuleSource; dir: string }

export type ConfigLayer = { source: RuleSource; dir: string; value: unknown }

export type Snapshot = {
  config: Config
  configLayers: ConfigLayer[]
  themeSpecs: Record<string, ThemeSpec>
  rules: Rule[]
  // Every discovered rule before `rules.disabled` / `rules.builtin` apply (the pane lists them).
  allRules: Rule[]
  append: string
  layers: Layer[]
  warnings: string[]
}

// The global layer, then one project layer per directory from root down to
// cwd, skipping home (already the global layer).
export function layerDirs(home: string | undefined, root: string, cwd: string): Layer[] {
  const layers: Layer[] = []
  if (home) layers.push({ source: 'global', dir: join(home, '.agents') })
  for (const dir of chainBetween(root, cwd)) {
    if (home && samePath(dir, home)) continue
    layers.push({ source: 'project', dir: join(dir, '.agents') })
  }
  return layers
}

export async function homeDir(io: Io): Promise<string | undefined> {
  return (await io.env('USERPROFILE')) || (await io.env('HOME')) || undefined
}

async function loadRules(io: Io, dir: string, source: RuleSource, warnings: string[]): Promise<Rule[]> {
  const rules: Rule[] = []
  for (const name of await io.listFiles(dir, '.md')) {
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
  const layers: Layer[] = [{ source: 'builtin', dir: where.builtinDir }, ...layerDirs(home, where.root, where.cwd)]

  const ruleLayers: Rule[][] = []
  const configLayers: ConfigLayer[] = []
  const themeSpecs: Record<string, ThemeSpec> = {}
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
        configLayers.push({ source: layer.source, dir: layer.dir, value: JSON.parse(cfgText) })
      } catch (err) {
        warnings.push(`${cfgPath}: invalid config.json (${err instanceof Error ? err.message : err})`)
      }
    }
    const append = await io.read(join(layer.dir, 'mods', 'APPEND_SYSTEM.md'))
    if (append !== undefined) appends.push(append)
    const themesDir = join(layer.dir, 'mods', 'themes')
    for (const file of await io.listFiles(themesDir, '.json')) {
      const path = join(themesDir, file)
      try {
        const spec = JSON.parse((await io.read(path)) ?? '') as ThemeSpec
        themeSpecs[file.replace(/\.json$/i, '')] = { ...spec, colors: spec.colors ?? {} }
      } catch (err) {
        warnings.push(`${path}: invalid theme (${err instanceof Error ? err.message : err})`)
      }
    }
  }

  const config = mergeConfig(configLayers.map(l => l.value))
  return {
    config,
    configLayers,
    themeSpecs,
    rules: mergeRules(ruleLayers, config),
    allRules: mergeRules(ruleLayers, { ...config, rules: { builtin: true, disabled: [] } }),
    append: mergeAppend(appends),
    layers,
    warnings,
  }
}
