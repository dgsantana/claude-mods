import type { InstructionFile } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { world } from './world'

const CLAUDE: InstructionFile = { path: '/repo/CLAUDE.md', kind: 'project', content: 'claude' }

test('adds project ancestors and global AGENTS.md as instruction files', async ($, on) => {
  world(on, { files: { '/home/u/.agents/AGENTS.md': 'global agents' } })
  on('fs.ancestors', () => ({ value: [
    { dir: '/repo', name: 'AGENTS.md', content: 'repo agents', parts: [] },
  ] }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))

  const r = await $.prompt.context({ blocks: [], instructionFiles: [CLAUDE] })
  expect(r.instructionFiles).toEqual([
    CLAUDE,
    { path: '/home/u/.agents/AGENTS.md', kind: 'user', content: 'global agents' },
    { path: '/repo/AGENTS.md', kind: 'project', content: 'repo agents' },
  ])
})

test('skips an AGENTS.md already loaded (e.g. @-imported by CLAUDE.md)', async ($, on) => {
  world(on, {})
  on('fs.ancestors', () => ({ value: [{ dir: '/repo', name: 'AGENTS.md', content: 'repo agents', parts: [] }] }))
  const imported: InstructionFile = { path: '/repo/AGENTS.md', kind: 'project', content: 'repo agents', parent: '/repo/CLAUDE.md' }
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))

  const r = await $.prompt.context({ blocks: [], instructionFiles: [CLAUDE, imported] })
  expect(r.instructionFiles).toEqual([CLAUDE, imported])
})

test('leaves the context alone when instructionFiles is unknown', async ($, on) => {
  world(on, {})
  on('fs.ancestors', () => ({ value: [{ dir: '/repo', name: 'AGENTS.md', content: 'repo agents', parts: [] }] }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))

  const r = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'rewritten' }] })
  expect(r.instructionFiles).toBeUndefined()
  expect(r.blocks).toEqual([{ name: 'claudeMd', text: 'rewritten' }])
})

test('disabled via config', async ($, on) => {
  world(on, { files: { '/home/u/.agents/mods/config.json': '{"agentsMd":{"enabled":false}}' } })
  on('fs.ancestors', () => ({ value: [{ dir: '/repo', name: 'AGENTS.md', content: 'repo agents', parts: [] }] }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))

  const r = await $.prompt.context({ blocks: [], instructionFiles: [CLAUDE] })
  expect(r.instructionFiles).toEqual([CLAUDE])
})
