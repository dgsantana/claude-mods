import { describe, expect, test } from 'bun:test'
import { editedPathOf, MAX_EDITS, withEdit } from '../hooks/edits'
import { editsPathOf } from '../hooks/snapshot'

describe('files a session edits, for the board to group changes by turn (increment 019)', () => {
  test('go to said/<session>.edits.json, only for a safe id', () => {
    expect(editsPathOf('/home/u/.agent-switchboard', 'abc-1')).toBe('/home/u/.agent-switchboard/said/abc-1.edits.json')
    expect(editsPathOf('/b', '../x')).toBeUndefined()
  })

  test('the file an editing tool writes; none for other tools', () => {
    expect(editedPathOf('Edit', { file_path: 'D:\\dev\\p\\src\\a.ts', old_string: 'x', new_string: 'y' })).toBe('D:\\dev\\p\\src\\a.ts')
    expect(editedPathOf('Write', { file_path: '/repo/new.md', content: '' })).toBe('/repo/new.md')
    expect(editedPathOf('NotebookEdit', { notebook_path: '/repo/n.ipynb' })).toBe('/repo/n.ipynb')
    expect(editedPathOf('Read', { file_path: '/repo/a.ts' })).toBeUndefined()
    expect(editedPathOf('Edit', { file_path: '' })).toBeUndefined()
    expect(editedPathOf('Bash', { command: 'sed -i s/a/b/ x' })).toBeUndefined()
  })

  test('appends oldest first, keeping the last 500; a broken file starts afresh', () => {
    let file: string | undefined
    for (let i = 1; i <= MAX_EDITS + 3; i++) file = withEdit(file, { at: 'x', path: `f${i}` })
    const kept = JSON.parse(file ?? '[]') as Array<{ path: string }>
    expect(kept).toHaveLength(MAX_EDITS)
    expect(kept[0]?.path).toBe('f4')
    expect(JSON.parse(withEdit('{ broken', { at: 'x', path: 'a' }))).toEqual([{ at: 'x', path: 'a' }])
  })
})
