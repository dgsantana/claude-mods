// Path helpers that accept both `/` and `\` separators, so Windows paths
// handed over by the engine work the same as POSIX ones.

export function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || (path.includes('\\') && !path.includes('/'))
}

const sepOf = (path: string) => (isWindowsPath(path) ? '\\' : '/')

export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(p => p !== '')
  return parts[parts.length - 1] ?? ''
}

export function join(base: string, ...parts: string[]): string {
  const sep = sepOf(base)
  let out = base.replace(/[\\/]+$/, '')
  if (out === '' || /^[a-zA-Z]:$/.test(out)) out += sep
  for (const p of parts) {
    const clean = p.replace(/^[\\/]+|[\\/]+$/g, '')
    if (clean === '') continue
    out += (out.endsWith(sep) ? '' : sep) + clean
  }
  return out
}

export function dirname(path: string): string {
  const sep = sepOf(path)
  const trimmed = path.replace(/[\\/]+$/, '')
  if (/^[a-zA-Z]:$/.test(trimmed)) return trimmed + sep
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (i < 0) return trimmed === '' ? path : '.'
  const head = trimmed.slice(0, i)
  if (head === '' || /^[a-zA-Z]:$/.test(head)) return head + sep
  return head
}

// Comparison key: forward slashes, no trailing slash; Windows paths compare
// case-insensitively, as the file system does.
function key(path: string): string {
  const p = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return isWindowsPath(path) ? p.toLowerCase() : p
}

export function samePath(a: string, b: string): boolean {
  return key(a) === key(b)
}

// The directories from `root` down to `cwd`, both included; just `cwd` when it
// is not beneath `root`.
export function chainBetween(root: string, cwd: string): string[] {
  const r = key(root)
  const c = key(cwd)
  if (c !== r && !c.startsWith(r + '/')) return [cwd]
  const chain: string[] = []
  let dir = cwd
  while (!samePath(dir, root)) {
    chain.unshift(dir)
    const up = dirname(dir)
    if (samePath(up, dir)) return [cwd]
    dir = up
  }
  chain.unshift(root)
  return chain
}
