import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { settingsTable } from '../../../scripts/settings-table'

test('README settings table matches the catalogue (run: bun scripts/settings-table.ts --write)', () => {
  const readme = readFileSync(join(import.meta.dir, '..', '..', '..', 'README.md'), 'utf8').replace(/\r\n/g, '\n')
  const m = /<!-- settings:start -->\n([\s\S]*?)<!-- settings:end -->/.exec(readme)
  expect(m?.[1]).toBe(settingsTable())
})
