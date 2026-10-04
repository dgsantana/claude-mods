import { describe, expect, test } from 'bun:test'
import { bg, fg, nearest256 } from './ansi'

describe('ansi', () => {
  test('truecolor emits 38;2 / 48;2', () => {
    expect(fg({ r: 1, g: 2, b: 3 }, true)).toBe('\x1b[38;2;1;2;3m')
    expect(bg({ r: 1, g: 2, b: 3 }, true)).toBe('\x1b[48;2;1;2;3m')
  })
  test('256 mode emits 38;5 / 48;5 only', () => {
    expect(fg({ r: 255, g: 0, b: 0 }, false)).toBe('\x1b[38;5;196m')
    expect(bg({ r: 128, g: 128, b: 128 }, false)).toBe('\x1b[48;5;244m')
  })
  test('nearest256 maps cube and grey ramp', () => {
    expect(nearest256({ r: 0, g: 0, b: 0 })).toBe(16)
    expect(nearest256({ r: 255, g: 255, b: 255 })).toBe(231)
    expect(nearest256({ r: 0x5f, g: 0x87, b: 0xaf })).toBe(67)
    expect(nearest256({ r: 0x80, g: 0x80, b: 0x80 })).toBe(244)
  })
})
