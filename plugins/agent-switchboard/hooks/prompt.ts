// Answering a prompt from the board (agent-switchboard decision 0009): what the mod sends the hub about
// an open prompt, and what the hub's answer does to the call. Pure; `register.ts` does the sending.

import { isRecord } from './guards'

export interface PromptQuestion {
  question: string
  header?: string
  kind: 'choice' | 'text' | 'number'
  options: string[]
  multiSelect: boolean
}

/** The hub's `POST /api/prompts` body. */
export interface BoardPrompt {
  id: string
  sessionId: string
  kind: 'permission' | 'question'
  tool: string
  description?: string
  /** What the call would act on, as the board prints it. */
  input?: string
  questions?: PromptQuestion[]
  openedAt: number
}

export type Outcome = { deny: string } | { allow: true } | { result: Record<string, unknown> }

const RESERVED = ['tool', 'tool_use_id', 'agentId', 'consent']
const QUESTION_KINDS: Record<string, PromptQuestion['kind']> = { choice: 'choice', text: 'text', number: 'number' }

export function promptOf(sessionId: string, id: string, tool: string, args: unknown, openedAt: number): BoardPrompt {
  const input = isRecord(args) ? args : {}
  if (tool === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions.flatMap(q => questionOf(q) ?? []) : []
    return { id, sessionId, kind: 'question', tool, questions, openedAt }
  }
  const prompt: BoardPrompt = { id, sessionId, kind: 'permission', tool, input: inputText(tool, input), openedAt }
  if (typeof input.description === 'string') prompt.description = input.description
  return prompt
}

function questionOf(value: unknown): PromptQuestion | undefined {
  if (!isRecord(value) || typeof value.question !== 'string') return undefined
  const options = Array.isArray(value.options) ? value.options.flatMap(o => (isRecord(o) && typeof o.label === 'string' ? [o.label] : [])) : []
  const question: PromptQuestion = {
    question: value.question,
    kind: (typeof value.kind === 'string' && QUESTION_KINDS[value.kind]) || 'choice',
    options,
    multiSelect: value.multiSelect === true,
  }
  if (typeof value.header === 'string') question.header = value.header
  return question
}

/** What the terminal shows a call would act on: the command, an edit's lines, a file's content. */
function inputText(tool: string, input: Record<string, unknown>): string {
  const { command, file_path: path, old_string: before, new_string: after, content } = input
  if (tool === 'Bash' && typeof command === 'string') return command
  if (tool === 'Edit' && typeof path === 'string' && typeof before === 'string' && typeof after === 'string') {
    const removed = before.split('\n').map(line => `- ${line}`)
    const added = after.split('\n').map(line => `+ ${line}`)
    return [path, '', ...removed, ...added].join('\n')
  }
  if (tool === 'Write' && typeof path === 'string' && typeof content === 'string') return `${path}\n\n${content}`
  const own = Object.fromEntries(Object.entries(input).filter(([key]) => !RESERVED.includes(key)))
  return JSON.stringify(own, null, 2)
}

/** The hub's answer as the call's outcome, or `undefined` when it is no answer this call can take. */
export function outcomeOf(answerText: string, tool: string, args: unknown): Outcome | undefined {
  let answer: unknown
  try {
    answer = JSON.parse(answerText)
  } catch {
    return undefined
  }
  if (!isRecord(answer)) return undefined
  if (tool === 'AskUserQuestion') {
    if (!isRecord(answer.answers)) return undefined
    const questions = isRecord(args) ? args.questions : undefined
    const result: Record<string, unknown> = { questions, answers: answer.answers }
    if (typeof answer.response === 'string') result.response = answer.response
    return { result }
  }
  if (answer.decision === 'allow') return { allow: true }
  if (answer.decision !== 'deny') return undefined
  const note = typeof answer.note === 'string' ? answer.note.trim() : ''
  return { deny: note ? `Denied from Agent Switchboard: ${note}` : 'Denied from Agent Switchboard.' }
}

/** A call by its tool and its own arguments, keys sorted: a re-run and its permission check compare equal. */
export function callKey(tool: string, args: unknown): string {
  const own = Object.entries(isRecord(args) ? args : {})
    .filter(([key]) => !RESERVED.includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([tool, own])
}

/** A call's own arguments, without the keys the engine reserves, to run it again. */
export function ownArgs(args: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(isRecord(args) ? args : {}).filter(([key]) => !RESERVED.includes(key)))
}
