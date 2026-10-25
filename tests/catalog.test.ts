import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parseText, previewRows, guessMapping, importBook } from '../src/imports.ts'
import { initialState } from '../src/model.ts'
import { nextTask, rate, restoreBackup } from '../src/review.ts'

test('16 catalog books have traceable assets and honest verification flags', async () => {
  const catalog = JSON.parse(await readFile('public/data/catalog.json', 'utf8'))
  assert.equal(catalog.length, 16)
  assert.equal(new Set(catalog.map((b: any) => b.id)).size, 16)
  for (const book of catalog) {
    const bytes = await readFile('public' + book.file)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), book.sha256)
    const grid = parseText(bytes.toString('utf8')),
      preview = previewRows(grid, guessMapping(grid[0]))
    assert.equal(preview.errors.length, 0, book.id)
    assert.equal(preview.valid.length, book.rows, book.id)
    assert.equal(new Set(preview.valid.map((r) => r.sourceId)).size, book.rows)
    assert.equal(
      new Set(preview.valid.map((r) => JSON.stringify([r.en, r.zh]))).size,
      book.rows,
      'exact duplicates must not become separate learning cards',
    )
    assert.equal(book.verification.edition, 'pending')
    if (book.evidenceFiles) {
      assert.equal(
        createHash('sha256')
          .update(await readFile('public/data/' + book.sourceFile))
          .digest('hex'),
        book.rawSha256,
      )
      for (const evidence of book.evidenceFiles) {
        assert.match(evidence.sha256, /^[a-f0-9]{64}$/)
        try {
          assert.equal(
            createHash('sha256')
              .update(await readFile(evidence.file))
              .digest('hex'),
            evidence.sha256,
          )
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          assert.equal(
            book.evidenceAvailability,
            'local-only',
            'public source retains provenance hashes, not publisher page images',
          )
        }
      }
    }
    if (book.id !== 'bnu-grade4-upper' && !book.id.endsWith('-2024')) {
      assert.equal(book.verification.meanings, 'pending')
      assert.ok(preview.valid.every((r) => !r.unit))
    }
  }
})

test('new primary books preserve textbook meanings, unit boundaries and old progress', async () => {
  const catalog = JSON.parse(await readFile('public/data/catalog.json', 'utf8'))
  const cases = [
    ['bnu-grade4-upper-2024', [28, 33, 19, 22, 26, 3], 'sound', '听起来'],
    ['bnu-grade4-lower-2024', [28, 15, 12, 17, 25, 0], 'give up', '放弃'],
    ['bnu-grade5-upper-2024', [20, 14, 8, 14, 13, 2], 'sweep', '快速移动'],
    ['bnu-grade6-upper-2024', [21, 17, 15, 17, 19, 0], 'give up', '认输'],
  ] as const
  for (const [id, counts, en, zh] of cases) {
    const book = catalog.find((b: any) => b.id === id)
    assert.equal(book.startGrade, 3)
    assert.equal(book.verification.cover, 'checked')
    assert.equal(book.verification.copyright, 'pending')
    const grid = parseText(await readFile('public' + book.file, 'utf8'))
    const rows = previewRows(grid, guessMapping(grid[0])).valid
    assert.deepEqual(
      counts.map((_, i) => rows.filter((r) => r.unit.startsWith(`Unit ${i + 1} `)).length),
      counts,
    )
    assert.equal(rows.find((r) => r.en === en)?.zh, zh)
    assert.ok(rows.every((r) => !r.en.startsWith('*') && !r.phonetic && !r.audio))
    const old = { ...catalog.find((b: any) => b.id === id.replace('-2024', '')), paused: false }
    const oldGrid = parseText(await readFile('public' + old.file, 'utf8'))
    let state = importBook(
      initialState(),
      old,
      previewRows(oldGrid, guessMapping(oldGrid[0])).valid,
    )
    state = rate(state, nextTask(state, new Date())!, 3, new Date(), false)
    const before = structuredClone(state)
    state = importBook(state, { ...book, paused: false }, rows)
    state = importBook(state, { ...book, paused: false }, rows)
    assert.deepEqual(state.cards, before.cards)
    assert.deepEqual(
      state.words.filter((w) => w.bookId === old.id),
      before.words,
    )
    assert.equal(state.books.length, 2)
    assert.equal(state.words.filter((w) => w.bookId === id).length, book.rows)
  }
})

test('2024 eight upper imports 460 textbook words separately from the old edition', async () => {
  const catalog = JSON.parse(await readFile('public/data/catalog.json', 'utf8'))
  const newer = catalog.find((book: any) => book.id === 'bnu-grade8-upper-2024')
  assert.ok(newer)
  assert.match(newer.edition, /2024/)
  assert.equal(newer.verification.cover, 'checked')
  assert.equal(newer.verification.copyright, 'pending')
  const grid = parseText(await readFile('public' + newer.file, 'utf8'))
  const rows = previewRows(grid, guessMapping(grid[0])).valid
  assert.equal(rows.length, 460)
  const units = [...new Set(rows.map((r) => r.unit))]
  assert.deepEqual(units, [
    'Unit 1 Sports',
    'Unit 2 Safety',
    'Unit 3 Feelings and Emotions',
    'Unit 4 Role Models',
    'Unit 5 Travel',
    'Unit 6 Celebrations',
  ])
  assert.deepEqual(
    units.map((unit) => rows.filter((r) => r.unit === unit).length),
    [86, 99, 91, 74, 46, 64],
  )
  assert.equal(rows.find((r) => r.en === 'motto')?.unit, 'Unit 1 Sports')
  assert.equal(rows.find((r) => r.en === 'lightning')?.unit, 'Unit 2 Safety')
  assert.equal(rows.find((r) => r.en === 'compare')?.unit, 'Unit 3 Feelings and Emotions')
  assert.equal(rows.find((r) => r.en === 'X-ray')?.unit, 'Unit 4 Role Models')
  assert.equal(rows.find((r) => r.en === 'had better')?.unit, 'Unit 5 Travel')
  assert.equal(rows.find((r) => r.en === 'as soon as')?.unit, 'Unit 6 Celebrations')
  assert.ok(rows.every((r) => !r.en.startsWith('*') && !/\d$/.test(r.zh)))
  const older = { ...catalog.find((book: any) => book.id === 'bnu-grade8-upper'), paused: false }
  const oldGrid = parseText(await readFile('public' + older.file, 'utf8'))
  let state = importBook(
    initialState(),
    older,
    previewRows(oldGrid, guessMapping(oldGrid[0])).valid,
  )
  state = rate(state, nextTask(state, new Date())!, 3, new Date(), false)
  const oldWords = structuredClone(state.words),
    oldCards = structuredClone(state.cards)
  state = importBook(state, { ...newer, paused: false }, rows)
  state = importBook(state, { ...newer, paused: false }, rows)
  assert.equal(state.books.length, 2)
  assert.deepEqual(
    state.words.filter((w) => w.bookId === older.id),
    oldWords,
  )
  assert.deepEqual(state.cards, oldCards)
  assert.equal(state.words.filter((w) => w.bookId === newer.id).length, 460)
})

test('four upper keeps textbook senses, six units and two distinct study meanings', async () => {
  const grid = parseText(await readFile('public/data/bnu-grade4-upper-reviewed.csv', 'utf8'))
  const { valid: rows, errors } = previewRows(grid, guessMapping(grid[0]))
  assert.deepEqual(errors, [])
  assert.equal(rows.length, 97)
  assert.equal(new Set(rows.map((r) => r.unit)).size, 6)
  assert.deepEqual(
    [...new Set(rows.map((r) => r.unit))].map((unit) => rows.filter((r) => r.unit === unit).length),
    [15, 25, 13, 20, 18, 6],
  )
  assert.equal(rows.find((r) => r.en === 'sign')?.zh, '标志，指示牌')
  assert.equal(rows.find((r) => r.en === 'doll')?.zh, '玩具娃娃')
  assert.equal(rows.find((r) => r.en === 'train')?.zh, '火车')
  assert.deepEqual(
    rows.filter((r) => r.en === 'study').map((r) => r.zh),
    ['书房', '学习'],
  )
  const book = {
    id: 'reviewed',
    title: '四上',
    publisher: '北师大版',
    grade: 4,
    semester: '上册',
    startGrade: 3,
    edition: '2013审定',
    source: '',
    paused: false,
  }
  let state = importBook(initialState(), book, rows)
  state = rate(state, nextTask(state, new Date())!, 3, new Date(), false)
  const before = structuredClone(state.cards)
  state = importBook(state, book, rows)
  assert.equal(state.words.length, rows.length)
  assert.deepEqual(state.cards, before)
  assert.deepEqual(restoreBackup(JSON.stringify(state)), state)
  const customRow = {
    ...rows[0],
    sourceId: 'custom-apple',
    en: 'apple',
    zh: '自备释义',
    unit: '自备单元',
  }
  state = importBook(state, { ...book, contentNote: undefined }, [customRow])
  state = importBook(state, { ...book, contentNote: '6个单元与课内释义已逐条对照' }, rows)
  assert.equal(state.words.length, rows.length + 1)
  assert.deepEqual(state.cards, before)
  assert.equal(
    state.books[0].contentNote,
    undefined,
    'mixed books must not regain a whole-book verification claim',
  )
})
