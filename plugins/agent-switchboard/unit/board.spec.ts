import { describe, expect, test } from 'bun:test'
import { BOARD_TOOL_CALLS, BOARD_TOOLS, boardListText, boardToolOf, docLinksLine, imageFilesOf, imageProblemOf, MAX_IMAGE_BYTES, tagOutcomeText, withImageHashes } from '../hooks/board'

describe('the whiteboard tools (decision 0014)', () => {
  test('five tools, called by their full names', () => {
    expect(BOARD_TOOLS.map(t => t.name)).toEqual(['board_list', 'board_read', 'board_write', 'board_comment', 'board_create'])
    expect(BOARD_TOOL_CALLS[2]).toBe('mcp__agent-switchboard__board_write')
    expect(boardToolOf('mcp__agent-switchboard__board_read')).toBe('board_read')
    expect(boardToolOf('mcp__other__board_read')).toBeUndefined()
  })

  test('the board list reads as one line a board; nothing usable says so', () => {
    const list = JSON.stringify([
      { id: 'p-5abda8d3', title: 'claude-mods', project: 'D:\\dev\\tools\\claude-mods', blocks: 4 },
      { id: 's-1234abcd', title: 'Design week', blocks: 0 },
    ])
    expect(boardListText(list)).toBe('p-5abda8d3: "claude-mods", the board of D:\\dev\\tools\\claude-mods, 4 blocks\ns-1234abcd: "Design week", shared, 0 blocks')
    expect(boardListText('[]')).toContain('No whiteboards yet')
    expect(boardListText('<html>')).toContain('not a board list')
  })

  test("a comment's tags read as one line each: prompted, or why not; no tags add nothing", () => {
    const answer = JSON.stringify({
      id: 's-1',
      tags: [
        { tag: 'vade-server', sessionId: '8f8e44c9', sent: true },
        { tag: 'nobody', sent: false, reason: 'no live Claude Code session is called or works in "nobody"' },
      ],
    })
    expect(tagOutcomeText(answer)).toBe('\nTags:\nvade-server: prompted to read it\nnobody: not prompted, no live Claude Code session is called or works in "nobody"')
    expect(tagOutcomeText(JSON.stringify({ id: 's-1' }))).toBe('')
    expect(tagOutcomeText('<html>')).toBe('')
  })

  test("a project's doc links come encoded, so the model copies them instead of encoding a path (increment 026)", () => {
    expect(docLinksLine('D:\\dev\\tools\\omp-board')).toBe(
      "Doc links for this project: `#/project/D%3A%5Cdev%5Ctools%5Comp-board/doc/` followed by the doc's path relative to the project, with / separators, as is.",
    )
    expect(docLinksLine('/home/u/src/claude-mods')).toContain('`#/project/%2Fhome%2Fu%2Fsrc%2Fclaude-mods/doc/`')
  })
})

describe('images on a whiteboard (increment 027)', () => {
  const ops = [
    { op: 'addBlock', block: { kind: 'image', file: 'D:\\shots\\before.png', text: 'Before' } },
    { op: 'addBlock', block: { kind: 'note', text: 'n' } },
    { op: 'addBlock', block: { kind: 'image', file: '/tmp/after.webp' } },
  ]

  test('the local files an addBlock asks to upload, and only those', () => {
    expect(imageFilesOf(ops)).toEqual(['D:\\shots\\before.png', '/tmp/after.webp'])
    expect(imageFilesOf('not ops')).toEqual([])
  })

  test('each file is replaced by its stored hash before the ops are sent', () => {
    const sent = withImageHashes(ops, { 'D:\\shots\\before.png': 'h1', '/tmp/after.webp': 'h2' }) as Array<{ block: Record<string, unknown> }>
    expect(sent[0]?.block).toEqual({ kind: 'image', image: 'h1', text: 'Before' })
    expect(sent[1]?.block).toEqual({ kind: 'note', text: 'n' })
    expect(sent[2]?.block).toEqual({ kind: 'image', image: 'h2' })
  })

  test('only PNG, JPEG, WebP or GIF files up to 2 MB are sent to the hub', () => {
    expect(imageProblemOf('a.PNG', 10)).toBeUndefined()
    expect(imageProblemOf('a.jpeg', MAX_IMAGE_BYTES)).toBeUndefined()
    expect(imageProblemOf('a.svg', 10)).toContain('PNG, JPEG, WebP or GIF')
    expect(imageProblemOf('C:\\Users\\u\\.ssh\\id_rsa', 10)).toContain('PNG, JPEG, WebP or GIF')
    expect(imageProblemOf('a.gif', MAX_IMAGE_BYTES + 1)).toContain('2 MB')
  })
})
