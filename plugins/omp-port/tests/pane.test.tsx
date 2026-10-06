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
  const status = (await $.command.run({ command: 'omp', args: 'advisor status' } as never)).text ?? ''
  expect(status).toMatch(/^Advisor on/)
})

test('mobile surface (no Input/Select) gets a note instead of controls', async ($, on) => {
  world(on, { themes: THEMES })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await pane.find({ text: /terminal or desktop/ })).toBeDefined()
})

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
function texts(tree: unknown, out: Node[] = []): Node[] {
  if (tree && typeof tree === 'object') {
    const n = tree as Node
    if (n.type === 'Text') out.push(n)
    for (const c of n.children ?? []) texts(c, out)
  }
  return out
}
const textOf = (n: Node): string => (n.children ?? []).map(c => (typeof c === 'string' ? c : '')).join('')

test('segments editor: up, remove and add write the list', async ($, on) => {
  const w = world(on, { themes: THEMES, files: { [GLOBAL]: '{"statusline":{"left":["model","path","git"]}}' } })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'seg-statusline.left-path-up' })
  expect(JSON.parse(w.writes[GLOBAL] ?? '{}').statusline.left).toEqual(['path', 'model', 'git'])
  await pane.press({ key: 'seg-statusline.left-git-remove' })
  expect(JSON.parse(w.writes[GLOBAL] ?? '{}').statusline.left).toEqual(['path', 'model'])
  await pane.select({ key: 'seg-statusline.left-add', value: 'caveman' })
  expect(JSON.parse(w.writes[GLOBAL] ?? '{}').statusline.left).toEqual(['path', 'model', 'caveman'])
})

test('preview follows the layout and recolours with the theme', async ($, on) => {
  world(on, {
    themes: { dark: { statusLineModel: '#111111' }, 'dark-nord': { statusLineModel: '#222222' } },
    files: { [GLOBAL]: '{"statusline":{"left":["path","model"],"right":["cost"]}}' },
  })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  let all = texts(await pane.drawn())
  const order = ['project', 'Opus', '$0.42'].map(s => all.findIndex(t => textOf(t).includes(s)))
  expect(order.every((v, i, a) => v >= 0 && (i === 0 || v > (a[i - 1] ?? -1)))).toBe(true)
  expect(all.find(t => textOf(t).includes('Opus'))?.props?.color).toBe('#111111')
  await pane.select({ key: 'set-statusline.theme', value: 'dark-nord' })
  all = texts(await pane.drawn())
  expect(all.find(t => textOf(t).includes('Opus'))?.props?.color).toBe('#222222')
})

test('rules tab lists rules with kind; toggling writes rules.disabled', async ($, on) => {
  const w = world(on, {
    themes: THEMES,
    files: {
      '/home/u/.agents/rules/alpha.md': '---\nalwaysApply: true\n---\nA',
      '/home/u/.agents/rules/beta.md': '---\ncondition: x\n---\nB',
    },
  })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-rules' })
  expect(await pane.find({ text: /alpha.*always/ })).toBeDefined()
  expect(await pane.find({ text: /beta.*ttsr/ })).toBeDefined()
  await pane.press({ key: 'rule-beta' })
  expect(JSON.parse(w.writes[GLOBAL] ?? '{}').rules.disabled).toEqual(['beta'])
  await pane.press({ key: 'rule-beta' })
  expect(JSON.parse(w.writes[GLOBAL] ?? '{}').rules.disabled).toEqual([])
})

test('advisor tab: spend shown, reset spend, budget goes to the store', async ($, on) => {
  const w = world(on, { themes: THEMES })
  mock.store(on, { 'advisor.totalUsd': 1.5 })
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-advisor' })
  expect(await pane.find({ text: /total \$1\.500/ })).toBeDefined()
  await pane.press({ key: 'advisor-reset-spend' })
  await pane.input({ key: 'set-advisor.budgetUsd', text: '3' })
  expect(Object.keys(w.writes)).toEqual([])
  const status = (await $.command.run({ command: 'omp', args: 'advisor status' } as never)).text ?? ''
  expect(status).toContain('$3.00')
  expect(status).toContain('total $0.000')
})

test('a failed write toasts and shows the error (I-3)', async ($, on) => {
  const w = world(on, { themes: THEMES, failWrites: true })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.select({ key: 'set-statusline.theme', value: 'dark-nord' })
  expect(w.toasts.some(t => t.includes(GLOBAL) && /EACCES/.test(t))).toBe(true)
  expect(await pane.find({ text: /EACCES/ })).toBeDefined()
})

test('an existing but unreadable config.json is never overwritten (I-4)', async ($, on) => {
  const w = world(on, { themes: THEMES, files: { [GLOBAL]: '{"keep":true}' }, unreadable: [GLOBAL] })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  await pane.select({ key: 'set-statusline.theme', value: 'dark-nord' })
  expect(w.writes[GLOBAL]).toBeUndefined()
  expect(w.toasts.some(t => t.includes(GLOBAL))).toBe(true)
})

test('status line config and theme warnings show on the Status line tab (I-5)', async ($, on) => {
  world(on, { themes: THEMES, files: { [GLOBAL]: '{"statusline":{"theme":"drak","left":["model","bogus"]}}' } })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: /drak/ })).toBeDefined()
  expect(await pane.find({ text: /bogus/ })).toBeDefined()
})

test('with the real theme count every Select stays within 64 options', async ($, on) => {
  const many: Record<string, Record<string, string>> = {}
  for (let i = 0; i < 60; i++) many[`dark-t${i}`] = { statusLineModel: '#111111' }
  for (let i = 0; i < 45; i++) many[`light-t${i}`] = { statusLineModel: '#222222' }
  many.dark = { statusLineModel: '#333333' }
  world(on, { themes: many })
  mock.store(on, {})
  on('ui.render', () => null as never)
  const pane = await $.ui.mount(PANE)
  const selects: { props?: Record<string, unknown> }[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
    if (node.type === 'Select') selects.push(node)
    for (const c of node.children ?? []) walk(c)
  }
  walk(await pane.drawn())
  expect(selects.length).toBeGreaterThan(0)
  for (const s of selects) expect((s.props?.options as unknown[]).length).toBeLessThanOrEqual(64)
  await pane.select({ key: 'set-statusline.theme-group', value: 'light' })
  expect(await pane.find({ key: 'set-statusline.theme' })).toBeDefined()
})
