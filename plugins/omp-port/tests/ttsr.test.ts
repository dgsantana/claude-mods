import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { world, type World } from './world'

const BOX_NEVER = '---\ncondition: "Box::leak"\nscope: "tool:edit(*.rs), tool:write(*.rs)"\ninterruptMode: never\n---\nNever use Box::leak.'
const TODO_ALWAYS = '---\ncondition: "(?i)hack"\nscope: tool\ninterruptMode: always\n---\nNo hacks.'
const GO_AST = '---\nastCondition: "for $I := 0; $I < $N; $I++ { $$$BODY }"\nscope: "tool:edit(*.go)"\ninterruptMode: never\n---\nUse range.'

type Ran = { calls: number; argv: string[][] }

// Stands for the engine beneath the plugin: tools that "run", and ast-grep.
function engine(on: On, w: World, astGrep: 'missing' | 'match' | 'nomatch' = 'missing'): Ran & { toasts: string[] } {
  const captured = world(on, w)
  const ran = { calls: 0, argv: [] as string[][], toasts: captured.toasts }
  on('tool.call', () => {
    ran.calls++
    return { result: { ok: true } as never }
  })
  on('process.run', ($, e) => {
    ran.argv.push([...e.argv])
    if (astGrep === 'missing') return { deny: 'spawn ast-grep ENOENT' }
    const stdout = astGrep === 'match' ? '[{"text":"for"}]' : '[]'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return ran
}

const edit = (file_path: string, new_string: string) =>
  ({ tool: 'Edit', file_path, old_string: 'x', new_string }) as const

test('never rule: tool runs, reminder rides in context, toast names the rule', async ($, on) => {
  const ran = engine(on, { files: { '/home/u/.agents/rules/box.md': BOX_NEVER } })
  const r = await $.tool.call(edit('/repo/lib.rs', 'Box::leak(Box::new(1))'))
  expect(ran.calls).toBe(1)
  expect(r.deny).toBeUndefined()
  expect(r.context?.[0]).toContain('rule="box"')
  expect(r.context?.[0]).toContain('Never use Box::leak.')
  expect(ran.toasts.some(t => t.includes('box'))).toBe(true)
})

test('never rule fires once per session in once mode', async ($, on) => {
  engine(on, { files: { '/home/u/.agents/rules/box.md': BOX_NEVER } })
  await $.tool.call(edit('/repo/lib.rs', 'Box::leak(a)'))
  const second = await $.tool.call(edit('/repo/lib.rs', 'Box::leak(b)'))
  expect(second.context ?? []).toEqual([])
})

test('always rule denies before the tool runs', async ($, on) => {
  const ran = engine(on, { files: { '/home/u/.agents/rules/nohack.md': TODO_ALWAYS } })
  const r = await $.tool.call({ tool: 'Write', file_path: '/repo/a.md', content: 'a HACK here' })
  expect(ran.calls).toBe(0)
  expect(r.deny).toContain('rule="nohack"')
  expect(r.deny).toContain('No hacks.')
})

test('non-matching edit passes untouched', async ($, on) => {
  const ran = engine(on, { files: { '/home/u/.agents/rules/box.md': BOX_NEVER } })
  const r = await $.tool.call(edit('/repo/lib.rs', 'Arc::new(1)'))
  expect(ran.calls).toBe(1)
  expect(r.context ?? []).toEqual([])
})

test('ttsr disabled in config: passthrough', async ($, on) => {
  const ran = engine(on, {
    files: { '/home/u/.agents/rules/nohack.md': TODO_ALWAYS, '/repo/.agents/mods/config.json': '{"ttsr":{"enabled":false}}' },
  })
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.md', content: 'hack' })
  expect(ran.calls).toBe(1)
})

test('ast-grep missing: AST rules skipped, one install toast per session', async ($, on) => {
  const ran = engine(on, { files: { '/home/u/.agents/rules/gorange.md': GO_AST } }, 'missing')
  const r1 = await $.tool.call(edit('/repo/main.go', 'for i := 0; i < n; i++ { f() }'))
  await $.tool.call(edit('/repo/main.go', 'for i := 0; i < n; i++ { g() }'))
  expect(ran.calls).toBe(2)
  expect(r1.context ?? []).toEqual([])
  expect(ran.toasts.filter(t => t.includes('ast-grep')).length).toBe(1)
})

test('ast-grep match: reminder delivered; argv carries pattern, lang and --stdin', async ($, on) => {
  const ran = engine(on, { files: { '/home/u/.agents/rules/gorange.md': GO_AST } }, 'match')
  const r = await $.tool.call(edit('/repo/main.go', 'for i := 0; i < n; i++ { f() }'))
  expect(r.context?.[0]).toContain('Use range.')
  const argv = ran.argv[0] ?? []
  expect(argv[0]).toBe('ast-grep')
  expect(argv).toContain('--stdin')
  expect(argv).toContain('go')
  expect(argv).toContain('for $I := 0; $I < $N; $I++ { $$$BODY }')
})

test('ast-grep no match: no reminder', async ($, on) => {
  engine(on, { files: { '/home/u/.agents/rules/gorange.md': GO_AST } }, 'nomatch')
  const r = await $.tool.call(edit('/repo/main.go', 'for i := range n {}'))
  expect(r.context ?? []).toEqual([])
})

test('huge Write payload completes with a match beyond the scan cap ignored', async ($, on) => {
  const ran = engine(on, { files: { '/home/u/.agents/rules/box.md': BOX_NEVER } })
  const content = 'a'.repeat(2 * 1024 * 1024) + 'Box::leak(x)'
  const r = await $.tool.call({ tool: 'Write', file_path: '/repo/big.rs', content })
  expect(ran.calls).toBe(1)
  expect(r.context ?? []).toEqual([])
})

test('after-gap: rule fires again after repeatGap completed turns', async ($, on) => {
  engine(on, {
    files: {
      '/home/u/.agents/rules/box.md': BOX_NEVER,
      '/home/u/.agents/mods/config.json': '{"ttsr":{"repeatMode":"after-gap","repeatGap":1}}',
    },
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.tool.call(edit('/repo/lib.rs', 'Box::leak(a)'))
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const again = await $.tool.call(edit('/repo/lib.rs', 'Box::leak(b)'))
  expect(again.context?.[0]).toContain('rule="box"')
})
