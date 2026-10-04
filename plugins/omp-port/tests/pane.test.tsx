import { expect, mock, test } from 'claude-code/testing'
import { world } from './world'

const THEMES = { dark: { statusLineModel: '#d787af' }, 'dark-nord': { statusLineModel: '#88c0d0' } }
const PANE = { plugin: 'omp-port', surface: 'terminal', component: 'Pane', requestId: 'omp-port-settings', props: {} as never } as const
const GLOBAL = '/home/u/.agents/mods/config.json'
const PROJECT = '/repo/.agents/mods/config.json'

test('/omp opens the settings pane; /omp ttsr opens on TTSR', async ($, on) => {
  const w = world(on, { themes: THEMES })
  mock.store(on, {})
  on('ui.render', () => null as never)
  await $.command.run({ command: 'omp', args: '' } as never)
  expect(w.opened).toEqual(['omp-port-settings'])
  await $.command.run({ command: 'omp', args: 'ttsr' } as never)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ key: 'set-ttsr.enabled' })).toBeDefined()
})

test('tab buttons switch rows', async ($, on) => {
  world(on, { themes: THEMES })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ key: 'set-statusline.theme' })).toBeDefined()
  await pane.press({ key: 'tab-advisor' })
  expect(await pane.find({ key: 'set-advisor.enabled' })).toBeDefined()
  expect(await pane.find({ key: 'set-statusline.theme' })).toBeUndefined()
})

test('a theme change writes only that key to the global file, keeping siblings', async ($, on) => {
  const w = world(on, { themes: THEMES, files: { [GLOBAL]: '{"ttsr":{"enabled":false}}' } })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.select({ key: 'set-statusline.theme', value: 'dark-nord' })
  expect(JSON.parse(w.writes[GLOBAL] ?? '{}')).toEqual({ ttsr: { enabled: false }, statusline: { theme: 'dark-nord' } })
  expect(w.writes[PROJECT]).toBeUndefined()
})

test('project scope writes the repo file and the origin label follows', async ($, on) => {
  const w = world(on, { themes: THEMES })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'scope-project' })
  await pane.select({ key: 'set-statusline.theme', value: 'dark-nord' })
  expect(JSON.parse(w.writes[PROJECT] ?? '{}')).toEqual({ statusline: { theme: 'dark-nord' } })
  expect(await pane.find({ text: /\(project\)/ })).toBeDefined()
})

test('reset removes the key from the chosen layer', async ($, on) => {
  const w = world(on, { themes: THEMES, files: { [GLOBAL]: '{"statusline":{"theme":"dark-nord","icons":"ascii"}}' } })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'reset-statusline.theme' })
  expect(JSON.parse(w.writes[GLOBAL] ?? '{}')).toEqual({ statusline: { icons: 'ascii' } })
})

test('invalid JSON at the target is never overwritten; toast names the file', async ($, on) => {
  const bad = '{ // hand edited\n "statusline": {} }'
  const w = world(on, { themes: THEMES, files: { [GLOBAL]: bad } })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.select({ key: 'set-statusline.theme', value: 'dark-nord' })
  expect(w.writes[GLOBAL]).toBeUndefined()
  expect(w.files.get(GLOBAL)).toBe(bad)
  expect(w.toasts.some(t => t.includes(GLOBAL))).toBe(true)
})

test('no repository: project scope refuses with a reason, writes stay global', async ($, on) => {
  const w = world(on, { themes: THEMES, repoRoot: null, cwd: '/home/u', root: '/home/u' })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'scope-project' })
  expect(w.toasts.some(t => /project/i.test(t))).toBe(true)
  await pane.select({ key: 'set-statusline.theme', value: 'dark-nord' })
  expect(Object.keys(w.writes)).toEqual([GLOBAL])
})

test('an invalid number shows the error and writes nothing', async ($, on) => {
  const w = world(on, { themes: THEMES })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.input({ key: 'set-statusline.ctx.warnAt', text: '150' })
  expect(Object.keys(w.writes)).toEqual([])
  expect(await pane.find({ text: /at most 100/ })).toBeDefined()
})

test('store-backed advisor settings write the store, not config', async ($, on) => {
  const w = world(on, { themes: THEMES })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-advisor' })
  await pane.press({ key: 'set-advisor.enabled' })
  expect(Object.keys(w.writes)).toEqual([])
  const status = (await $.command.run({ command: 'advisor', args: 'status' } as never)).text ?? ''
  expect(status).toMatch(/^Advisor on/)
})

test('mobile surface (no Input/Select) gets a note instead of controls', async ($, on) => {
  world(on, { themes: THEMES })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await pane.find({ text: /terminal or desktop/ })).toBeDefined()
})
