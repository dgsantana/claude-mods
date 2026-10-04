import { describe, expect, test } from 'bun:test'
import { getPath, setPath, unsetPath } from '../hooks/config-patch'

const parse = (r: { text: string } | { error: string }) => {
  if ('error' in r) throw new Error(r.error)
  return JSON.parse(r.text)
}

describe('setPath', () => {
  test('missing or empty file → new object with nested key', () => {
    expect(parse(setPath(undefined, 'statusline.theme', 'dark-nord'))).toEqual({ statusline: { theme: 'dark-nord' } })
    expect(parse(setPath('', 'a', 1))).toEqual({ a: 1 })
    expect(parse(setPath('  \n', 'a', 1))).toEqual({ a: 1 })
  })
  test('siblings kept, arrays replaced whole', () => {
    const text = '{"statusline":{"left":["model","git"],"theme":"x"},"ttsr":{"enabled":false}}'
    expect(parse(setPath(text, 'statusline.left', ['git']))).toEqual({ statusline: { left: ['git'], theme: 'x' }, ttsr: { enabled: false } })
  })
  test('a non-object on the path is replaced by an object', () => {
    expect(parse(setPath('{"statusline":3}', 'statusline.theme', 'y'))).toEqual({ statusline: { theme: 'y' } })
  })
  test('invalid JSON (comments, trailing comma) → error, never text', () => {
    expect('error' in setPath('{ // hi\n "a": 1 }', 'a', 2)).toBe(true)
    expect('error' in setPath('{ "a": 1, }', 'a', 2)).toBe(true)
    expect('error' in setPath('[1,2]', 'a', 2)).toBe(true)
  })
  test('output is 2-space JSON with trailing newline; CRLF input fine', () => {
    const r = setPath('{\r\n  "a": 1\r\n}\r\n', 'b', true)
    expect('text' in r && r.text).toBe('{\n  "a": 1,\n  "b": true\n}\n')
  })
})

describe('unsetPath', () => {
  test('removes the key and prunes empty parents', () => {
    expect(parse(unsetPath('{"statusline":{"theme":"x"},"a":1}', 'statusline.theme'))).toEqual({ a: 1 })
    expect(parse(unsetPath('{"statusline":{"theme":"x","icons":"nerd"}}', 'statusline.theme'))).toEqual({ statusline: { icons: 'nerd' } })
  })
  test('missing key or file is a no-op', () => {
    expect(parse(unsetPath('{"a":1}', 'b.c'))).toEqual({ a: 1 })
    expect(parse(unsetPath(undefined, 'b'))).toEqual({})
  })
  test('invalid JSON → error', () => {
    expect('error' in unsetPath('{nope', 'a')).toBe(true)
  })
})

describe('getPath', () => {
  test('reads nested values; missing → undefined', () => {
    expect(getPath({ a: { b: [1] } }, 'a.b')).toEqual([1])
    expect(getPath({ a: 1 }, 'a.b')).toBeUndefined()
    expect(getPath(undefined, 'a')).toBeUndefined()
  })
})
