import { describe, expect, test } from 'bun:test'
import { BOARD_TOOL_CALLS, BOARD_TOOLS, boardListText, boardToolOf } from '../hooks/board'

describe('the whiteboard tools (decision 0014)', () => {
  test('four tools, called by their full names', () => {
    expect(BOARD_TOOLS.map(t => t.name)).toEqual(['board_list', 'board_read', 'board_write', 'board_comment'])
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
})
