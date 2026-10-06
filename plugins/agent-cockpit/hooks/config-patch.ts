// Edits one key path of a config.json text, keeping everything else. A file
// that is not a valid JSON object is reported, never rewritten.

type Obj = Record<string, unknown>
type Patched = { text: string } | { error: string }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function parse(text: string | undefined): { obj: Obj } | { error: string } {
  if (text === undefined || text.trim() === '') return { obj: {} }
  try {
    const v: unknown = JSON.parse(text)
    return isObj(v) ? { obj: v } : { error: 'config.json is not a JSON object' }
  } catch (err) {
    return { error: `config.json is not valid JSON (${err instanceof Error ? err.message : err})` }
  }
}

const serialise = (o: Obj) => JSON.stringify(o, null, 2) + '\n'

export function getPath(obj: unknown, key: string): unknown {
  let cur = obj
  for (const p of key.split('.')) {
    if (!isObj(cur)) return undefined
    cur = cur[p]
  }
  return cur
}

export function setPath(text: string | undefined, key: string, value: unknown): Patched {
  const parsed = parse(text)
  if ('error' in parsed) return parsed
  const obj = parsed.obj
  const parts = key.split('.')
  let node = obj
  for (const p of parts.slice(0, -1)) {
    if (!isObj(node[p])) node[p] = {}
    node = node[p] as Obj
  }
  node[parts[parts.length - 1] ?? key] = value
  return { text: serialise(obj) }
}

export function unsetPath(text: string | undefined, key: string): Patched {
  const parsed = parse(text)
  if ('error' in parsed) return parsed
  const obj = parsed.obj
  const parts = key.split('.')
  const trail: Obj[] = [obj]
  for (const p of parts.slice(0, -1)) {
    const next = trail[trail.length - 1]?.[p]
    if (!isObj(next)) return { text: serialise(obj) }
    trail.push(next)
  }
  delete trail[trail.length - 1]?.[parts[parts.length - 1] ?? key]
  for (let i = trail.length - 1; i > 0; i--) {
    if (Object.keys(trail[i] ?? {}).length > 0) break
    delete trail[i - 1]?.[parts[i - 1] ?? '']
  }
  return { text: serialise(obj) }
}
