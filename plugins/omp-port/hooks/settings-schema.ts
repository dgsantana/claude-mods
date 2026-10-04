// The catalogue of every omp-port setting. It drives the config defaults,
// validation, the /omp pane's rows and the README's settings table.

import type { Config } from './layers'

export const SEGMENT_IDS = [
  'model', 'caveman', 'mode', 'path', 'git', 'pr', 'session', 'tokens', 'cost', 'fiveHour', 'ctx',
] as const
export type SegmentId = (typeof SEGMENT_IDS)[number]

export const SEPARATORS = ['powerline', 'powerline-thin', 'slash', 'pipe', 'block', 'none', 'ascii'] as const
export const ICON_SETS = ['nerd', 'ascii', 'none'] as const
export const PATH_STYLES = ['basename', 'full', 'home'] as const

export type Tab = 'statusline' | 'ttsr' | 'rules' | 'advisor' | 'context'
export const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'statusline', label: 'Status line' },
  { id: 'ttsr', label: 'TTSR' },
  { id: 'rules', label: 'Rules' },
  { id: 'advisor', label: 'Advisor' },
  { id: 'context', label: 'Context' },
]

export type SettingKind =
  | { kind: 'bool' }
  | { kind: 'enum'; options: readonly string[] }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'string' }
  | { kind: 'theme' }
  | { kind: 'segments' }
  | { kind: 'stringList' }

export type Setting = {
  key: string
  tab: Tab
  label: string
  description: string
  default: unknown
  storage?: 'config' | 'store'
} & SettingKind

export const SETTINGS: readonly Setting[] = [
  { key: 'statusline.theme', tab: 'statusline', label: 'Theme', kind: 'theme', default: 'dark',
    description: 'Colour theme: one of the 102 omp themes or a custom one from .agents/mods/themes/.' },
  { key: 'statusline.separator', tab: 'statusline', label: 'Separator', kind: 'enum', options: SEPARATORS, default: 'powerline-thin',
    description: 'How segments are separated; powerline draws filled segments on the theme background.' },
  { key: 'statusline.icons', tab: 'statusline', label: 'Icons', kind: 'enum', options: ICON_SETS, default: 'nerd',
    description: 'Nerd Font glyphs, short ASCII labels, or no icons.' },
  { key: 'statusline.left', tab: 'statusline', label: 'Left segments', kind: 'segments',
    default: ['model', 'caveman', 'mode', 'path', 'git', 'pr'], description: 'Segments on the left, in order.' },
  { key: 'statusline.right', tab: 'statusline', label: 'Right segments', kind: 'segments',
    default: ['session', 'tokens', 'cost', 'fiveHour', 'ctx'], description: 'Segments on the right, in order.' },
  { key: 'statusline.path.style', tab: 'statusline', label: 'Path style', kind: 'enum', options: PATH_STYLES, default: 'basename',
    description: 'Folder name only, the full path, or the path relative to home (~).' },
  { key: 'statusline.git.aheadBehind', tab: 'statusline', label: 'Git ahead/behind', kind: 'bool', default: true,
    description: 'Show ↑/↓ commit counts against the upstream branch.' },
  { key: 'statusline.fiveHour.showReset', tab: 'statusline', label: '5h reset time', kind: 'bool', default: true,
    description: 'Show the time until the 5-hour usage window resets.' },
  { key: 'statusline.ctx.warnAt', tab: 'statusline', label: 'Context warn %', kind: 'number', min: 0, max: 100, default: 50,
    description: 'Context use at which the segment turns to the warning colour.' },
  { key: 'statusline.ctx.errorAt', tab: 'statusline', label: 'Context error %', kind: 'number', min: 0, max: 100, default: 80,
    description: 'Context use at which the segment turns to the error colour.' },

  { key: 'ttsr.enabled', tab: 'ttsr', label: 'Enabled', kind: 'bool', default: true,
    description: 'Check every Edit/Write against trigger rules.' },
  { key: 'ttsr.interruptMode', tab: 'ttsr', label: 'Interrupt mode', kind: 'enum',
    options: ['always', 'tool-only', 'never', 'prose-only'], default: 'always',
    description: 'Default for rules without their own: always/tool-only deny the edit, never reminds after it.' },
  { key: 'ttsr.repeatMode', tab: 'ttsr', label: 'Repeat', kind: 'enum', options: ['once', 'after-gap'], default: 'once',
    description: 'A rule fires once per session, or again after a gap of completed turns.' },
  { key: 'ttsr.repeatGap', tab: 'ttsr', label: 'Repeat gap', kind: 'number', min: 1, max: 1000, default: 10,
    description: 'Completed turns before an after-gap rule may fire again.' },

  { key: 'rules.builtin', tab: 'rules', label: 'Built-in rules', kind: 'bool', default: true,
    description: 'Load the rules vendored from oh-my-pi.' },
  { key: 'rules.disabled', tab: 'rules', label: 'Disabled rules', kind: 'stringList', default: [],
    description: 'Rule names to drop.' },

  { key: 'advisor.enabled', tab: 'advisor', label: 'Enabled', kind: 'bool', default: false, storage: 'store',
    description: 'Review turns that edited files.' },
  { key: 'advisor.model', tab: 'advisor', label: 'Model', kind: 'string', default: '', storage: 'store',
    description: 'Reviewer model id; empty reuses the session through a cached fork.' },
  { key: 'advisor.budgetUsd', tab: 'advisor', label: 'Budget (USD)', kind: 'number', min: 0, default: undefined, storage: 'store',
    description: 'The advisor turns itself off once total spend reaches this; empty for none.' },

  { key: 'append.enabled', tab: 'context', label: 'APPEND_SYSTEM', kind: 'bool', default: true,
    description: 'Append .agents/mods/APPEND_SYSTEM.md to the system prompt.' },
  { key: 'agentsMd.enabled', tab: 'context', label: 'AGENTS.md', kind: 'bool', default: true,
    description: 'Load AGENTS.md files beside CLAUDE.md.' },
]

export function settingsFor(tab: Tab): Setting[] {
  return SETTINGS.filter(s => s.tab === tab)
}

export function validate(setting: Setting, value: unknown): { value: unknown } | { error: string } {
  switch (setting.kind) {
    case 'bool':
      return typeof value === 'boolean' ? { value } : { error: 'expected true or false' }
    case 'enum':
      return typeof value === 'string' && setting.options.includes(value)
        ? { value }
        : { error: `expected one of ${setting.options.join(', ')}` }
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
      if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'expected a number' }
      if (setting.min !== undefined && n < setting.min) return { error: `must be at least ${setting.min}` }
      if (setting.max !== undefined && n > setting.max) return { error: `must be at most ${setting.max}` }
      return { value: n }
    }
    case 'string':
      return typeof value === 'string' ? { value: value.trim() } : { error: 'expected text' }
    case 'theme':
      return typeof value === 'string' && value.trim() !== '' ? { value: value.trim() } : { error: 'expected a theme name' }
    case 'segments': {
      if (!Array.isArray(value)) return { error: 'expected a list of segments' }
      const known: readonly unknown[] = SEGMENT_IDS
      const bad = value.find(v => !known.includes(v))
      if (bad !== undefined) return { error: `unknown segment ${String(bad)}` }
      if (new Set(value).size !== value.length) return { error: 'a segment appears twice' }
      return { value: [...value] }
    }
    case 'stringList':
      return Array.isArray(value) && value.every(v => typeof v === 'string') ? { value: [...value] } : { error: 'expected a list of names' }
  }
}

export type SchemaDefaults = Pick<Config, 'statusline' | 'ttsr' | 'rules' | 'append' | 'agentsMd'>

// The defaults as a nested config object; store-backed settings are left out.
export function schemaDefaults(): SchemaDefaults {
  const out: Record<string, unknown> = {}
  for (const s of SETTINGS) {
    if (s.storage === 'store') continue
    const parts = s.key.split('.')
    let node = out
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>
    node[parts[parts.length - 1] ?? s.key] = Array.isArray(s.default) ? [...s.default] : s.default
  }
  return out as SchemaDefaults
}
