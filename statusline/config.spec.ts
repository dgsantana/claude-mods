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
