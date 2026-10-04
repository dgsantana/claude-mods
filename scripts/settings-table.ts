#!/usr/bin/env bun
// Prints (or with --write, puts into README.md) the settings table generated
// from the omp-port settings catalogue.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS, TABS } from '../plugins/omp-port/hooks/settings-schema'

const show = (v: unknown) => (v === undefined || v === '' ? 'none' : `\`${JSON.stringify(v)}\``)

export function settingsTable(): string {
  const lines = ['| Key | Tab | Default | Values | Meaning |', '|---|---|---|---|---|']
  for (const s of SETTINGS) {
    const tab = TABS.find(t => t.id === s.tab)?.label ?? s.tab
    const values =
      s.kind === 'enum' ? s.options.map(o => `\`${o}\``).join(' ') :
      s.kind === 'number' ? [s.min !== undefined ? `≥ ${s.min}` : '', s.max !== undefined ? `≤ ${s.max}` : ''].filter(Boolean).join(', ') || 'number' :
      s.kind === 'segments' ? 'segment ids' : s.kind === 'stringList' ? 'names' : s.kind === 'theme' ? 'theme name' : s.kind
    const where = s.storage === 'store' ? ' (stored by `/advisor`, not config.json)' : ''
    lines.push(`| \`${s.key}\` | ${tab} | ${show(s.default)} | ${values} | ${s.description}${where} |`)
  }
  return lines.join('\n') + '\n'
}

if (import.meta.main) {
  const table = settingsTable()
  if (!process.argv.includes('--write')) process.stdout.write(table)
  else {
    const file = join(import.meta.dir, '..', 'README.md')
    const readme = readFileSync(file, 'utf8')
    const next = readme.replace(/<!-- settings:start -->\n[\s\S]*?<!-- settings:end -->/, `<!-- settings:start -->\n${table}<!-- settings:end -->`)
    writeFileSync(file, next)
    console.log(next === readme ? 'README.md already up to date' : 'README.md updated')
  }
}
