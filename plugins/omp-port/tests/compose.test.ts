import { expect, test } from 'claude-code/testing'
import { world } from './world'

const INPUT = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] }
const BASE = { id: 'intro', text: 'engine intro', scope: 'shared' as const }

const RULES = {
  '/home/u/.agents/rules/always.md': '---\nalwaysApply: true\n---\nAlways do X.',
  '/home/u/.agents/rules/book.md': '---\ndescription: Read for DB work\nglobs: "*.sql"\n---\nDB body',
  '/home/u/.agents/rules/trig.md': '---\ncondition: "foo"\ndescription: trigger rule\n---\nTrigger body',
  '/home/u/.agents/rules/plain.md': 'no frontmatter, no description',
}

test('append and rules sections land after the engine sections, session scope', async ($, on) => {
  world(on, {
    files: {
      ...RULES,
      '/home/u/.agents/mods/APPEND_SYSTEM.md': 'Global append.',
      '/repo/.agents/mods/APPEND_SYSTEM.md': 'Project append.',
    },
  })
  on('prompt.compose', () => ({ sections: [BASE] }))

  const { sections } = await $.prompt.compose(INPUT)
  expect(sections[0]).toEqual(BASE)
  const append = sections.find(s => s.id === 'omp-port:append')
  expect(append).toEqual({ id: 'omp-port:append', text: 'Global append.\n\nProject append.', scope: 'session' })

  const rules = sections.find(s => s.id === 'omp-port:rules')
  expect(rules?.scope).toBe('session')
  expect(rules?.text).toContain('Always do X.')
  expect(rules?.text).toContain('- book (*.sql): Read for DB work → /home/u/.agents/rules/book.md')
  expect(rules?.text).not.toContain('Trigger body')
  expect(rules?.text).not.toContain('trigger rule')
  expect(rules?.text).not.toContain('plain')
})

test('no files: no extra sections', async ($, on) => {
  world(on, {})
  on('prompt.compose', () => ({ sections: [BASE] }))
  const { sections } = await $.prompt.compose(INPUT)
  expect(sections).toEqual([BASE])
})

test('append disabled by project config', async ($, on) => {
  world(on, {
    files: {
      '/home/u/.agents/mods/APPEND_SYSTEM.md': 'Global append.',
      '/repo/.agents/mods/config.json': '{"append":{"enabled":false}}',
    },
  })
  on('prompt.compose', () => ({ sections: [BASE] }))
  const { sections } = await $.prompt.compose(INPUT)
  expect(sections.some(s => s.id === 'omp-port:append')).toBe(false)
})

test('a broken world falls through to the engine sections', async ($, on) => {
  world(on, { broken: true })
  on('prompt.compose', () => ({ sections: [BASE] }))
  const { sections } = await $.prompt.compose(INPUT)
  expect(sections).toEqual([BASE])
})

test('a rule warning is logged once, not on every turn', async ($, on) => {
  const w = world(on, { files: { '/home/u/.agents/rules/bad.md': '---\nscope: "a","b"\ndescription: d\n---\nx' } })
  on('prompt.compose', () => ({ sections: [BASE] }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  await $.prompt.compose(INPUT)
  await $.turn.start({ text: 't', turnId: 't1' } as never)
  await $.prompt.compose(INPUT)
  expect(w.logs.filter(l => l.includes('bad.md')).length).toBe(1)
})
