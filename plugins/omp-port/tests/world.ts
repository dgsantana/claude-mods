// A fake world beneath the plugin for engine tests: an in-memory filesystem,
// session paths, environment, and captured toasts/logs.

import type { FsEntry, On } from 'claude-code'
import { mock } from 'claude-code/testing'

export type World = {
  files?: Record<string, string>
  env?: Record<string, string>
  cwd?: string
  root?: string
  repoRoot?: string | null
  broken?: boolean
  // Served for any path ending in themes/builtin.json (the plugin's theme table).
  themes?: Record<string, Record<string, string>>
}

export type Captured = { toasts: string[]; logs: string[]; writes: Record<string, string>; opened: string[]; files: Map<string, string> }

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

export function world(on: On, w: World): Captured {
  const files = new Map(Object.entries(w.files ?? {}).map(([k, v]) => [norm(k), v]))
  const isDir = (p: string) => [...files.keys()].some(k => k.startsWith(norm(p) + '/'))
  const captured: Captured = { toasts: [], logs: [], writes: {}, opened: [], files }
  const themes = w.themes ? JSON.stringify(w.themes) : undefined
  const isThemes = (p: string) => norm(p).endsWith('/themes/builtin.json')

  const gone = () => {
    throw new Error('disk gone')
  }
  mock.env(on, w.env ?? { HOME: '/home/u' })
  on('session.cwd', () => (w.broken ? gone() : { value: w.cwd ?? '/repo' }))
  on('session.root', () => ({ value: w.root ?? w.cwd ?? '/repo' }))
  on('session.repo', () => ({
    value: w.repoRoot === null ? null : { root: w.repoRoot ?? w.root ?? '/repo', remote: null, internal: false, name: null, id: 'repo' },
  }))
  on('fs.exists', ($, e) => (w.broken ? gone() : { value: files.has(norm(e.path)) || isDir(e.path) || (isThemes(e.path) && themes !== undefined) }))
  on('fs.read', ($, e) => {
    const text = files.get(norm(e.path)) ?? (isThemes(e.path) ? themes : undefined)
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', ($, e) => {
    if (w.broken) gone()
    const dir = norm(e.path) + '/'
    const names = new Set<string>()
    const out: FsEntry[] = []
    for (const k of files.keys()) {
      if (!k.startsWith(dir)) continue
      const rest = k.slice(dir.length)
      const name = rest.split('/')[0] ?? rest
      if (names.has(name)) continue
      names.add(name)
      out.push({ name, kind: rest.includes('/') ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false })
    }
    return { value: out }
  })
  on('fs.write', ($, e) => {
    files.set(norm(e.path), e.text)
    captured.writes[norm(e.path)] = e.text
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    captured.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', ($, e) => {
    captured.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    captured.logs.push(e.text)
    return { value: undefined }
  })
  return captured
}
