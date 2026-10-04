import { describe, expect, test } from 'bun:test'
import { DEFAULT_CONFIG, mergeAppend, mergeConfig, mergeRules } from '../hooks/layers'
import { discover, type Io } from '../hooks/load'
import type { Rule } from '../hooks/rule'

const rule = (name: string, source: Rule['source'], extra: Partial<Rule> = {}): Rule => ({
  name, path: `/${source}/${name}.md`, content: source, source, enabled: true, ...extra,
})

describe('mergeRules', () => {
  test('higher layer shadows lower by name', () => {
    const out = mergeRules([[rule('a', 'builtin'), rule('b', 'builtin')], [rule('a', 'global')], [rule('b', 'project')]], DEFAULT_CONFIG)
    expect(out.map(r => [r.name, r.source])).toEqual([['a', 'global'], ['b', 'project']])
  })
  test('disabled list and enabled:false remove rules', () => {
    const cfg = mergeConfig([{ rules: { disabled: ['a'] } }])
    const out = mergeRules([[rule('a', 'builtin'), rule('b', 'builtin'), rule('c', 'global', { enabled: false })]], cfg)
    expect(out.map(r => r.name)).toEqual(['b'])
  })
  test('builtin:false removes only builtins', () => {
    const cfg = mergeConfig([{ rules: { builtin: false } }])
    const out = mergeRules([[rule('a', 'builtin')], [rule('b', 'global')]], cfg)
    expect(out.map(r => r.name)).toEqual(['b'])
  })
  test('a project rule disabled by enabled:false hides the global one of the same name', () => {
    const out = mergeRules([[rule('a', 'global')], [rule('a', 'project', { enabled: false })]], DEFAULT_CONFIG)
    expect(out).toEqual([])
  })
})

describe('mergeConfig', () => {
  test('deep merges objects, higher wins, arrays replace', () => {
    const cfg = mergeConfig([
      { ttsr: { repeatMode: 'after-gap' }, rules: { disabled: ['x', 'y'] } },
      { ttsr: { repeatGap: 3 }, rules: { disabled: ['z'] } },
    ])
    expect(cfg.ttsr).toMatchObject({ enabled: true, interruptMode: 'always', repeatMode: 'after-gap', repeatGap: 3 })
    expect(cfg.rules.disabled).toEqual(['z'])
  })
  test('defaults: advisor off, all else on', () => {
    expect(DEFAULT_CONFIG.advisor.enabled).toBe(false)
    expect(DEFAULT_CONFIG.append.enabled && DEFAULT_CONFIG.agentsMd.enabled && DEFAULT_CONFIG.ttsr.enabled).toBe(true)
  })
  test('ignores non-object layers', () => {
    expect(mergeConfig([null, 3, 'x', []]).ttsr.enabled).toBe(true)
  })
})

describe('mergeAppend', () => {
  test('concatenates low to high with a blank line', () => {
    expect(mergeAppend(['---\n---\nglobal', 'project'])).toBe('global\n\nproject')
  })
  test('replace:true drops lower layers', () => {
    expect(mergeAppend(['global', '---\nreplace: true\n---\nproject'])).toBe('project')
  })
  test('empty parts are skipped', () => {
    expect(mergeAppend(['', '  ', 'x'])).toBe('x')
  })
})

// In-memory filesystem keyed by normalised path.
function fakeIo(files: Record<string, string>, env: Record<string, string | undefined>): Io {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const map = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  return {
    env: async name => env[name],
    read: async p => map.get(norm(p)),
    listMarkdown: async dir => {
      const d = norm(dir) + '/'
      return [...map.keys()]
        .filter(k => k.startsWith(d) && !k.slice(d.length).includes('/') && /\.mdc?$/.test(k))
        .map(k => k.slice(d.length))
        .sort()
    },
  }
}

describe('discover', () => {
  const builtinDir = '/plugin/builtin-rules'
  test('layers builtin → global → project chain; nearest wins', async () => {
    const io = fakeIo({
      [`${builtinDir}/a.md`]: '---\ncondition: x\n---\nbuiltin a',
      '/home/d/.agents/rules/a.md': 'global a',
      '/home/d/.agents/mods/APPEND_SYSTEM.md': 'G',
      '/home/d/.agents/mods/config.json': '{"ttsr":{"repeatGap":4}}',
      '/repo/.agents/rules/b.md': 'repo b',
      '/repo/pkg/.agents/rules/b.md': 'pkg b',
      '/repo/pkg/.agents/mods/APPEND_SYSTEM.md': 'P',
      '/repo/pkg/.agents/mods/config.json': '{"ttsr":{"repeatGap":7}}',
    }, { HOME: '/home/d' })
    const snap = await discover(io, { builtinDir, root: '/repo', cwd: '/repo/pkg' })
    expect(snap.rules.map(r => [r.name, r.content])).toEqual([['a', 'global a'], ['b', 'pkg b']])
    expect(snap.append).toBe('G\n\nP')
    expect(snap.config.ttsr.repeatGap).toBe(7)
    expect(snap.layers.map(l => l.source)).toEqual(['builtin', 'global', 'project', 'project'])
  })

  test('Windows: USERPROFILE used when HOME unset; backslash paths', async () => {
    const io = fakeIo({ 'C:\\Users\\d\\.agents\\rules\\w.md': 'win rule' }, { USERPROFILE: 'C:\\Users\\d' })
    const snap = await discover(io, { builtinDir: 'C:\\p\\builtin-rules', root: 'C:\\proj', cwd: 'C:\\proj' })
    expect(snap.rules.map(r => r.name)).toEqual(['w'])
    expect(snap.rules[0].path).toBe('C:\\Users\\d\\.agents\\rules\\w.md')
  })

  test('no repo: cwd outside root still loads global and cwd layers', async () => {
    const io = fakeIo({ '/home/d/.agents/rules/g.md': 'g', '/tmp/x/.agents/rules/c.md': 'c' }, { HOME: '/home/d' })
    const snap = await discover(io, { builtinDir, root: '/tmp/x', cwd: '/tmp/x' })
    expect(snap.rules.map(r => r.name).sort()).toEqual(['c', 'g'])
  })

  test('home inside the project chain is not loaded twice', async () => {
    const io = fakeIo({ '/home/d/.agents/mods/APPEND_SYSTEM.md': 'once' }, { HOME: '/home/d' })
    const snap = await discover(io, { builtinDir, root: '/home/d', cwd: '/home/d/p' })
    expect(snap.append).toBe('once')
  })

  test('bad config.json is ignored with a warning', async () => {
    const io = fakeIo({ '/home/d/.agents/mods/config.json': '{nope' }, { HOME: '/home/d' })
    const snap = await discover(io, { builtinDir, root: '/r', cwd: '/r' })
    expect(snap.config.ttsr.enabled).toBe(true)
    expect(snap.warnings.some(w => w.includes('config.json'))).toBe(true)
  })

  test('rule parse warnings are surfaced', async () => {
    const io = fakeIo({ '/home/d/.agents/rules/bad.md': '---\nscope: "a","b"\n---\nx' }, { HOME: '/home/d' })
    const snap = await discover(io, { builtinDir, root: '/r', cwd: '/r' })
    expect(snap.warnings.some(w => w.includes('bad.md'))).toBe(true)
  })
})
