import { describe, expect, test } from 'bun:test'
import { callKey, outcomeOf, ownArgs, promptOf } from '../hooks/prompt'

describe('the prompt sent to the board', () => {
  test('a Bash call: its description and the full command', () => {
    expect(promptOf('s1', 't1', 'Bash', { command: 'git push\n--force', description: 'Push it' }, 1000)).toEqual({
      id: 't1',
      sessionId: 's1',
      kind: 'permission',
      tool: 'Bash',
      description: 'Push it',
      input: 'git push\n--force',
      openedAt: 1000,
    })
  })

  test('an Edit call: the file, then the lines it removes and adds', () => {
    const prompt = promptOf('s1', 't2', 'Edit', { file_path: '/repo/a.ts', old_string: 'one\ntwo', new_string: 'three' }, 1)
    expect(prompt.input).toBe('/repo/a.ts\n\n- one\n- two\n+ three')
  })

  test('a Write call: the file, then its content', () => {
    expect(promptOf('s1', 't3', 'Write', { file_path: '/repo/b.md', content: '# B' }, 1).input).toBe('/repo/b.md\n\n# B')
  })

  test('any other tool: its arguments as JSON, without the engine\'s own keys', () => {
    const prompt = promptOf('s1', 't4', 'WebFetch', { url: 'https://x', prompt: 'p', tool: 'WebFetch', tool_use_id: 't4' }, 1)
    expect(JSON.parse(prompt.input ?? '')).toEqual({ url: 'https://x', prompt: 'p' })
  })

  test('an AskUserQuestion: a question form with each question\'s kind and options', () => {
    const prompt = promptOf(
      's1',
      't5',
      'AskUserQuestion',
      {
        questions: [
          { question: 'Colour?', header: 'Colour', options: [{ label: 'Red', description: 'r' }, { label: 'Blue' }], multiSelect: false },
          { question: 'How many?', header: 'Count', kind: 'number', options: [], multiSelect: false },
        ],
      },
      1,
    )
    expect(prompt.kind).toBe('question')
    expect(prompt.questions).toEqual([
      { question: 'Colour?', header: 'Colour', kind: 'choice', options: ['Red', 'Blue'], multiSelect: false },
      { question: 'How many?', header: 'Count', kind: 'number', options: [], multiSelect: false },
    ])
  })
})

describe("the board's answer, as the call's outcome", () => {
  const questions = [{ question: 'Colour?', header: 'C', options: [], multiSelect: false }]

  test('deny, with or without a note', () => {
    expect(outcomeOf('{"decision":"deny"}', 'Bash', {})).toEqual({ deny: 'Denied from Agent Switchboard.' })
    expect(outcomeOf('{"decision":"deny","note":"use staging"}', 'Bash', {})).toEqual({
      deny: 'Denied from Agent Switchboard: use staging',
    })
  })

  test('allow once', () => {
    expect(outcomeOf('{"decision":"allow"}', 'Bash', {})).toEqual({ allow: true })
  })

  test("a form's answers become the tool's result, with a free-text response when given", () => {
    expect(outcomeOf('{"answers":{"Colour?":"Blue"}}', 'AskUserQuestion', { questions })).toEqual({
      result: { questions, answers: { 'Colour?': 'Blue' } },
    })
    expect(outcomeOf('{"answers":{"Colour?":"Blue"},"response":"soon"}', 'AskUserQuestion', { questions })).toEqual({
      result: { questions, answers: { 'Colour?': 'Blue' }, response: 'soon' },
    })
  })

  test('anything else is no answer, and the terminal decides', () => {
    expect(outcomeOf('not json', 'Bash', {})).toBeUndefined()
    expect(outcomeOf('{"decision":"maybe"}', 'Bash', {})).toBeUndefined()
    expect(outcomeOf('{"answers":{"Colour?":"Blue"}}', 'Bash', {})).toBeUndefined()
    expect(outcomeOf('{"decision":"allow"}', 'AskUserQuestion', { questions })).toBeUndefined()
  })
})

describe('matching a re-run to its permission check', () => {
  test('the same tool and arguments match whatever their order and the engine keys', () => {
    const call = { command: 'ls', description: 'List', tool: 'Bash', tool_use_id: 't1' }
    expect(callKey('Bash', call)).toBe(callKey('Bash', { description: 'List', command: 'ls' }))
    expect(callKey('Bash', call)).not.toBe(callKey('Bash', { command: 'ls -a', description: 'List' }))
    expect(ownArgs(call)).toEqual({ command: 'ls', description: 'List' })
  })
})
