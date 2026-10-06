import { expect, mock, test } from 'claude-code/testing'
import { world } from './world'

test('a refused command registration does not stop /dgs from registering', async ($, on) => {
  world(on, {})
  mock.store(on, {})
  const registered: string[] = []
  on('command.register', ($, e) => {
    if (e.name === 'advisor') return { deny: '"/advisor" refused: it is the built-in /advisor' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  expect(registered).toContain('dgs')
  expect(registered).not.toContain('advisor')
})

test('the built-in /advisor is left alone (no agent-cockpit hook answers it)', async ($, on) => {
  world(on, {})
  mock.store(on, {})
  on('command.run', ($, e) => ({ text: `engine ran /${e.command}` }))
  const r = await $.command.run({ command: 'advisor', args: 'status' } as never)
  expect(r.text).toBe('engine ran /advisor')
})

test('/dgs advisor <verb> runs the advisor commands', async ($, on) => {
  world(on, {})
  mock.store(on, {})
  expect((await $.command.run({ command: 'dgs', args: 'advisor on' } as never)).text).toMatch(/Advisor on/)
  expect((await $.command.run({ command: 'dgs', args: 'advisor status' } as never)).text).toMatch(/^Advisor on/)
})
