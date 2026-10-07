import { describe, expect, test } from 'bun:test'
import { BOARD_TOOL_CALLS, BOARD_TOOLS, boardListText, boardToolOf, docLinksLine, tagOutcomeText } from '../hooks/board'

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
