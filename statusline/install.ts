#!/usr/bin/env bun
// Prints (default) or writes (--write) the statusLine entry for this script
// into ~/.claude/settings.json. Works on Linux and Windows.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function buildCommand(scriptPath: string): string {
  return `bun "${scriptPath.replace(/\\/g, '/')}"`
}

export function patchSettings(text: string, command: string): string {
  const settings = text.trim() === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
  settings.statusLine = { type: 'command', command, padding: 0 }
  return JSON.stringify(settings, null, 2) + '\n'
}

if (import.meta.main) {
  const command = buildCommand(join(import.meta.dir, 'statusline.ts'))
  const file = join(homedir(), '.claude', 'settings.json')
  if (!process.argv.includes('--write')) {
    console.log(`Add to ${file}:\n`)
    console.log(JSON.stringify({ statusLine: { type: 'command', command, padding: 0 } }, null, 2))
    console.log('\nOr run: bun statusline/install.ts --write')
  } else {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const patched = patchSettings(text, command)
    if (existsSync(file)) copyFileSync(file, `${file}.bak`)
    writeFileSync(file, patched)
    console.log(`statusLine written to ${file} (backup: ${file}.bak)`)
  }
}
