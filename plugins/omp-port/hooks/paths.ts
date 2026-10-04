// Path helpers that accept both `/` and `\` separators, so Windows paths
// handed over by the engine work the same as POSIX ones.

export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(p => p !== '')
  return parts.length > 0 ? parts[parts.length - 1] : ''
}
