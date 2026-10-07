// What a session is doing right now, as one short line from the tool call it last started (increment
// 025 in the agent-switchboard repository). Pure: `register.ts` records it when a call starts.

import { isRecord } from './guards'

/** The longest activity line, including the ellipsis that marks a cut. */
export const MAX_ACTIVITY_CHARS = 80

const MCP_TOOL = /^mcp__(.+?)__(.+)$/
const URL_HOST = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/:?#]+)/i

export function activityOf(tool: string, input: unknown): string {
  const text = describe(tool, isRecord(input) ? input : {}) ?? tool
  return text.length <= MAX_ACTIVITY_CHARS ? text : `${text.slice(0, MAX_ACTIVITY_CHARS - 1)}…`
}

function describe(tool: string, input: Record<string, unknown>): string | undefined {
  const text = (key: string): string | undefined => {
    const value = input[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  const labelled = (label: string, value: string | undefined) => (value === undefined ? undefined : `${label}${value}`)
  switch (tool) {
    case 'Edit':
    case 'Write':
      return labelled('editing ', basenameOf(text('file_path')))
    case 'NotebookEdit':
      return labelled('editing ', basenameOf(text('notebook_path')))
    case 'Read':
      return labelled('reading ', basenameOf(text('file_path')))
    case 'Bash':
      // The description is shorter than the command and less likely to carry a secret.
      return labelled('running ', text('description') ?? text('command')?.split('\n')[0]?.trim())
    case 'Grep':
      return labelled('searching ', text('pattern'))
    case 'Glob':
      return labelled('finding ', text('pattern'))
    case 'WebFetch':
      return labelled('fetching ', URL_HOST.exec(text('url') ?? '')?.[1])
    case 'WebSearch':
      return labelled('searching the web: ', text('query'))
    case 'Agent':
      return labelled('delegating: ', text('description'))
    case 'Skill':
      return labelled('using skill ', text('skill'))
  }
  const mcp = MCP_TOOL.exec(tool)
  return mcp ? `${mcp[2]} (${mcp[1]})` : undefined
}

function basenameOf(path: string | undefined): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).at(-1)
}
