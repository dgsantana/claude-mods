import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadStatusline } from './config'

let root = ''
let home = ''
let project = ''
let cacheDir = ''
const write = (p: string, text: string) => {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'slcfg-'))
  home = join(root, 'home')
  project = join(root, 'proj')
  cacheDir = join(root, 'cache')
  mkdirSync(project, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const input = () => ({ workspace: { current_dir: project, project_dir: project } })
const env = () => ({ HOME: home })

describe('loadStatusline', () => {
  test('no files → defaults and dark', async () => {
    const r = (await loadStatusline(input(), env(), cacheDir))
    expect(r.config.theme).toBe('dark')
    expect(r.config.separator).toBe('powerline-thin')
    expect(r.theme.statusLineModel).toBeDefined()
  })
  test('project config overrides global; project custom theme used', async () => {
    write(join(home, '.agents/mods/config.json'), '{"statusline":{"theme":"dark-nord","separator":"pipe"}}')
    write(join(project, '.agents/mods/config.json'), '{"statusline":{"theme":"mine"}}')
    write(join(project, '.agents/mods/themes/mine.json'), '{"extends":"dark","colors":{"statusLineModel":"#000002"}}')
    const r = (await loadStatusline(input(), env(), cacheDir))
    expect(r.config.theme).toBe('mine')
    expect(r.config.separator).toBe('pipe')
    expect(r.theme.statusLineModel).toEqual({ r: 0, g: 0, b: 2 })
  })
  test('invalid config.json → defaults with a warning, no throw', async () => {
    write(join(home, '.agents/mods/config.json'), '{ // comment\n}')
    const r = (await loadStatusline(input(), env(), cacheDir))
    expect(r.config.theme).toBe('dark')
    expect(r.warnings.some(w => w.includes('config.json'))).toBe(true)
  })
  test('cache invalidates when a config mtime changes', async () => {
    const cfg = join(home, '.agents/mods/config.json')
    write(cfg, '{"statusline":{"separator":"pipe"}}')
    expect((await loadStatusline(input(), env(), cacheDir)).config.separator).toBe('pipe')
    write(cfg, '{"statusline":{"separator":"slash"}}')
    const t = new Date(Date.now() + 5000)
    utimesSync(cfg, t, t)
    expect((await loadStatusline(input(), env(), cacheDir)).config.separator).toBe('slash')
  })
})

describe('review fixes', () => {
  test('editing a custom theme file in place refreshes the status line (I-1)', async () => {
    write(join(home, '.agents/mods/config.json'), '{"statusline":{"theme":"mine"}}')
    const theme = join(home, '.agents/mods/themes/mine.json')
    write(theme, '{"colors":{"statusLineModel":"#ff0000"}}')
    expect((await loadStatusline(input(), env(), cacheDir)).theme.statusLineModel).toEqual({ r: 255, g: 0, b: 0 })
    write(theme, '{"colors":{"statusLineModel":"#00ff00"}}')
    const t = new Date(Date.now() + 5000)
    utimesSync(theme, t, t)
    expect((await loadStatusline(input(), env(), cacheDir)).theme.statusLineModel).toEqual({ r: 0, g: 255, b: 0 })
  })
  test('started in a repo subfolder: the repo root .agents is read (I-2)', async () => {
    mkdirSync(join(project, '.git'), { recursive: true })
    const sub = join(project, 'pkg')
    mkdirSync(sub, { recursive: true })
    write(join(project, '.agents/mods/config.json'), '{"statusline":{"separator":"slash"}}')
    const r = await loadStatusline({ workspace: { current_dir: sub, project_dir: sub } }, env(), cacheDir)
    expect(r.config.separator).toBe('slash')
  })
  test('a stale cached config missing keys is re-sanitised (M-2)', async () => {
    await loadStatusline(input(), env(), cacheDir)
    const { readdirSync, readFileSync } = await import('node:fs')
    const file = join(cacheDir, readdirSync(cacheDir).find(f => f.startsWith('claude-mods-statusline-cfg-')) ?? '')
    const cached = JSON.parse(readFileSync(file, 'utf8'))
    cached.loaded.config = { theme: 'dark' }
    writeFileSync(file, JSON.stringify(cached))
    const r = await loadStatusline(input(), env(), cacheDir)
    expect(r.config.left.length).toBeGreaterThan(0)
    expect(r.config.ctx.warnAt).toBe(50)
  })
})
