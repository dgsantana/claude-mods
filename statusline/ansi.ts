// ANSI colour output: truecolor when the terminal says it has it, else the
// nearest xterm-256 colour (cube or grey ramp; 0–15 vary per terminal).

import type { Rgb } from '../plugins/omp-port/hooks/themes'

const LEVELS = [0, 95, 135, 175, 215, 255]

const dist = (a: Rgb, b: Rgb) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2

function level(v: number): number {
  let best = 0
  for (let i = 1; i < LEVELS.length; i++) if (Math.abs((LEVELS[i] ?? 0) - v) < Math.abs((LEVELS[best] ?? 0) - v)) best = i
  return best
}

export function nearest256(c: Rgb): number {
  const [ri, gi, bi] = [level(c.r), level(c.g), level(c.b)]
  const cube = { r: LEVELS[ri] ?? 0, g: LEVELS[gi] ?? 0, b: LEVELS[bi] ?? 0 }
  const cubeIndex = 16 + 36 * ri + 6 * gi + bi
  const grey = Math.min(23, Math.max(0, Math.round(((c.r + c.g + c.b) / 3 - 8) / 10)))
  const g = 8 + 10 * grey
  return dist(c, { r: g, g, b: g }) < dist(c, cube) ? 232 + grey : cubeIndex
}

export function fg(c: Rgb, truecolor: boolean): string {
  return truecolor ? `\x1b[38;2;${c.r};${c.g};${c.b}m` : `\x1b[38;5;${nearest256(c)}m`
}

export function bg(c: Rgb, truecolor: boolean): string {
  return truecolor ? `\x1b[48;2;${c.r};${c.g};${c.b}m` : `\x1b[48;5;${nearest256(c)}m`
}

export const RESET = '\x1b[0m'
