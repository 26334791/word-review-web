import test from 'node:test'
import assert from 'node:assert/strict'
import { readSheet } from 'read-excel-file/node'
import { previewRows, guessMapping } from '../src/imports.ts'
test('actual candidate workbook maps British phonetics and preserves all 106 source rows', async () => {
  const grid = (await readSheet('public/data/bnu-grade4-upper.xlsx')).map((row) =>
    row.map((cell) => String(cell ?? '')),
  )
  const preview = previewRows(grid, guessMapping(grid[0]))
  assert.equal(preview.errors.length, 0)
  assert.equal(preview.valid.length, 106)
  assert.equal(preview.valid[0].en, 'sign')
  assert.equal(preview.valid[0].phonetic, '[saɪn]')
  assert.equal(preview.valid[0].unit, '')
})
