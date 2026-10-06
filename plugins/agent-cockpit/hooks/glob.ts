// Minimal glob matching for rule scopes and `globs`: `*`, `**`, `?`, `{a,b}`.
// A glob without `/` matches the basename; one with `/` matches a path tail
// that starts at a segment boundary. Both separator styles are accepted.

const cache = new Map<string, RegExp>()

function toRegExp(glob: string): RegExp {
  let re = ''
  let inBrace = false
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? ''
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      inBrace = true
      re += '(?:'
    } else if (c === '}' && inBrace) {
      inBrace = false
      re += ')'
    } else if (c === ',' && inBrace) re += '|'
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

export function globMatches(glob: string, path: string): boolean {
  const g = glob.replace(/\\/g, '/')
  let re = cache.get(g)
  if (!re) {
    re = toRegExp(g)
    cache.set(g, re)
  }
  const p = path.replace(/\\/g, '/')
  if (!g.includes('/')) return re.test(p.slice(p.lastIndexOf('/') + 1))
  const parts = p.split('/')
  for (let i = 0; i < parts.length; i++) if (re.test(parts.slice(i).join('/'))) return true
  return false
}
