import test from 'node:test'
import assert from 'node:assert/strict'
import { initialState } from '../src/model.ts'
import type { Book } from '../src/model.ts'
import { parseText, previewRows, guessMapping, importBook } from '../src/imports.ts'

const book: Book = {
  id: 'bnu4',
  title: '北师大四上',
  publisher: '北师大版',
  grade: 4,
  semester: '上册',
  startGrade: 3,
  edition: '版次待核对',
  source: '',
  paused: false,
}
const preview = (text: string) => {
  const grid = parseText(text)
  return previewRows(grid, guessMapping(grid[0]))
}

test('quoted comma and newline remain in one definition; blank rows do not create words', () => {
  const result = preview('英文,释义\napple,"苹果,水果"\nhello,"你好\n问候"\n\n')
  assert.equal(result.valid.length, 2)
  assert.equal(result.valid[0].zh, '苹果,水果')
  assert.equal(result.valid[1].zh, '你好\n问候')
})
test('missing meaning and unsafe audio report original row numbers', () => {
  const result = preview(
    '英文\t释义\t发音\nlook out\t小心\t\nempty\t\t\nhello\t你好\tjavascript:alert(1)',
  )
  assert.equal(result.valid.length, 1)
  assert.equal(result.valid[0].en, 'look out')
  assert.deepEqual(
    result.errors.map((e) => e.row),
    [3, 4],
  )
})
test('duplicate words merge unit membership while homographs stay separate', () => {
  const rows = preview('英文,释义,单元\nlight,光,Unit 1\nlight,光,Unit 2\nlight,轻的,Unit 2').valid
  const state = importBook(initialState(), book, rows)
  assert.equal(state.words.length, 2)
  assert.deepEqual(state.words[0].units, ['Unit 1', 'Unit 2'])
  assert.equal(initialState().words.length, 0)
})
test('substantive source-id update archives old entry and repeated revision is idempotent', () => {
  const first = importBook(initialState(), book, preview('标识,英文,释义\nw1,light,光').valid)
  const next = importBook(first, book, preview('标识,英文,释义\nw1,light,轻的').valid)
  assert.equal(next.words.length, 2)
  assert.equal(next.words[0].archived, true)
  const repeated = importBook(next, book, preview('标识,英文,释义\nw1,light,轻的').valid)
  assert.equal(repeated.words.length, 2)
  assert.equal(repeated.words.filter((w) => !w.archived).length, 1)
})
test('stable-id unit correction replaces old membership and merges repeated rows in the new file', () => {
  const first = importBook(
    initialState(),
    book,
    preview('标识,英文,释义,单元\nw1,light,光,Unit 1').valid,
  )
  const next = importBook(
    first,
    book,
    preview('标识,英文,释义,单元\nw1,light,光,Unit 2\nw1,light,光,Unit 3').valid,
  )
  assert.deepEqual(next.words[0].units, ['Unit 2', 'Unit 3'])
  assert.equal(next.words[0].id, first.words[0].id)
})
