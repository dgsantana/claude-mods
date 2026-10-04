// Frontmatter for omp-format rule files: a small YAML subset (scalars, quoted
// strings, flow and block sequences, comments), with omp's fallback of
// re-parsing `key: value` lines one by one when the whole block fails.

export type Frontmatter = {
  data: Record<string, unknown>
  body: string
  warning?: string
}

class YamlError extends Error {}

const camel = (key: string) => key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

function stripComment(s: string): string {
  let quote: string | undefined
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = undefined
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1] ?? ''))) return s.slice(0, i).trimEnd()
  }
  return s
}

// Reads one quoted string starting at `s[i]`; returns the value and the index after it.
function readQuoted(s: string, i: number): [string, number] {
  const q = s[i]
  let out = ''
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j]
    if (q === "'" && c === "'") {
      if (s[j + 1] === "'") {
        out += "'"
        j++
        continue
      }
      return [out, j + 1]
    }
    if (q === '"' && c === '\\') {
      const n = s[++j]
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n
      continue
    }
    if (q === '"' && c === '"') return [out, j + 1]
    out += c
  }
  throw new YamlError('unterminated string')
}

function plain(s: string): unknown {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~' || s === '') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

function parseFlow(s: string): unknown[] {
  const items: unknown[] = []
  let i = 1
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === ',') i++
    if (s[i] === ']') {
      if (s.slice(i + 1).trim() !== '') throw new YamlError('text after ]')
      return items
    }
    if (s[i] === '"' || s[i] === "'") {
      const [v, next] = readQuoted(s, i)
      items.push(v)
      i = next
      while (s[i] === ' ') i++
      if (s[i] !== ',' && s[i] !== ']') throw new YamlError('junk after quoted item')
    } else {
      let j = i
      while (j < s.length && s[j] !== ',' && s[j] !== ']') j++
      items.push(plain(s.slice(i, j).trim()))
      i = j
    }
  }
  throw new YamlError('unclosed flow sequence')
}

export function parseScalar(raw: string): unknown {
  const s = stripComment(raw).trim()
  if (s.startsWith('[')) return parseFlow(s)
  if (s.startsWith('"') || s.startsWith("'")) {
    const [v, next] = readQuoted(s, 0)
    if (s.slice(next).trim() !== '') throw new YamlError('junk after quoted scalar')
    return v
  }
  if (s.startsWith('{')) throw new YamlError('flow mappings unsupported')
  return plain(s)
}

function parseStrict(lines: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  let listKey: string | undefined
  for (const line of lines) {
    if (stripComment(line).trim() === '') continue
    const item = /^\s+-\s*(.*)$/.exec(line)
    if (item) {
      if (!listKey) throw new YamlError('sequence item without key')
      ;(data[listKey] as unknown[]).push(parseScalar(item[1] ?? ''))
      continue
    }
    const kv = /^([\w-]+):(?:\s+(.*))?$/.exec(line)
    if (!kv) throw new YamlError(`unparseable line: ${line}`)
    const key = camel(kv[1] ?? '')
    const rest = kv[2] === undefined ? '' : stripComment(kv[2]).trim()
    if (rest === '') {
      data[key] = []
      listKey = key
    } else {
      data[key] = parseScalar(rest)
      listKey = undefined
    }
  }
  return data
}

function parseLoose(lines: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const line of lines) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = camel(kv[1] ?? '')
    const raw = (kv[2] ?? '').trim()
    try {
      data[key] = parseScalar(raw)
    } catch {
      data[key] = raw
    }
  }
  return data
}

export function parseFrontmatter(text: string): Frontmatter {
  const src = text.replace(/\r\n/g, '\n')
  if (!src.startsWith('---\n')) return { data: {}, body: text }
  const end = src.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: text }
  const afterClose = src.indexOf('\n', end + 4)
  const body = (afterClose === -1 ? '' : src.slice(afterClose + 1)).trim()
  const lines = src.slice(4, end).split('\n')
  try {
    return { data: parseStrict(lines), body }
  } catch (err) {
    return { data: parseLoose(lines), body, warning: err instanceof Error ? err.message : String(err) }
  }
}
