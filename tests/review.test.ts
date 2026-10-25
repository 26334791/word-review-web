import test from 'node:test'
import assert from 'node:assert/strict'
import { fsrs, createEmptyCard, Rating } from 'ts-fsrs'
import { initialState } from '../src/model.ts'
import type { Word } from '../src/model.ts'
import { nextTask, rate, stats, undo, restoreBackup } from '../src/review.ts'

const now = new Date('2026-10-25T03:00:00Z')
function fixture() {
  const state = initialState()
  state.books.push({
    id: 'b',
    title: '四上',
    publisher: '北师大版',
    grade: 4,
    semester: '上册',
    startGrade: 3,
    edition: '待核对',
    source: '',
    paused: false,
  })
  state.settings.bookId = 'b'
  for (let i = 0; i < 2; i++)
    state.words.push({
      id: `w${i}`,
      sourceId: `s${i}`,
      bookId: 'b',
      en: ['hello', 'apple'][i],
      zh: ['你好', '苹果'][i],
      pos: '',
      phonetic: '',
      units: ['未分单元'],
      order: i,
      audio: '',
      example: '',
    } satisfies Word)
  return state
}
test('new read feedback schedules read and creates independent ungraded listening', () => {
  const state = fixture()
  const task = nextTask(state, now)
  assert.ok(task)
  assert.equal(task.kind, 'new')
  const next = rate(state, task, Rating.Good, now, false)
  assert.equal(next.logs.length, 1)
  assert.equal(next.cards['w0:listen'].schedule, null)
  const expected = fsrs({ request_retention: 0.9, enable_fuzz: false }).next(
    createEmptyCard(now),
    now,
    Rating.Good,
  ).card
  assert.equal(next.cards['w0:read'].schedule?.due, expected.due.toISOString())
  next.settings.dailyNew = 0
  assert.equal(nextTask(next, now)?.direction, 'listen')
})
test('listening failure cannot grade and blocked listening does not prevent new words', () => {
  let state = fixture()
  state = rate(state, nextTask(state, now)!, Rating.Good, now, false)
  const listen = nextTask(state, now)!
  assert.equal(listen.direction, 'listen')
  assert.throws(() => rate(state, listen, Rating.Good, now, false), /播放/)
  assert.equal(nextTask(state, now, new Set([listen.key]))?.word.id, 'w1')
  state = rate(state, listen, Rating.Again, now, true)
  assert.equal(stats(state, now).newToday, 1)
  assert.equal(stats(state, now).learned, 1)
  assert.notEqual(state.cards['w0:read'].schedule?.due, state.cards['w0:listen'].schedule?.due)
})
test('due cards outrank new words and midnight undo removes first-listen without counting today', () => {
  const before = new Date('2026-10-25T15:59:30Z')
  const after = new Date('2026-10-25T16:00:30Z')
  let state = fixture()
  state = rate(state, nextTask(state, before)!, Rating.Again, before, false)
  assert.equal(stats(state, after).newToday, 0)
  assert.equal(nextTask(state, new Date('2026-10-25T16:10:00Z'))?.kind, 'due')
  state = undo(state, after)
  assert.equal(stats(state, after).learned, 0)
  assert.equal(Object.keys(state.cards).length, 0)
})
test('stale task, early review and exhausted new quota cannot be submitted', () => {
  const state = fixture()
  const task = nextTask(state, now)!
  const changed = structuredClone(state)
  changed.revision++
  assert.throws(() => rate(changed, task, Rating.Good, now, false), /更新|刷新/)
  state.settings.dailyNew = 0
  assert.equal(nextTask(state, now), null)
  assert.throws(() => rate(state, task, Rating.Good, now, false), /额度/)
})
test('backup round trip preserves schedules; invalid references and unsafe resources are rejected', () => {
  let state = fixture()
  state = rate(state, nextTask(state, now)!, Rating.Good, now, false)
  const restored = restoreBackup(JSON.stringify(state))
  assert.equal(restored.cards['w0:read'].schedule?.due, state.cards['w0:read'].schedule?.due)
  const bad = structuredClone(state)
  bad.words[0].audio = 'javascript:alert(1)'
  assert.throws(() => restoreBackup(JSON.stringify(bad)))
  const badReference = structuredClone(state)
  badReference.words[0].bookId = 'missing'
  assert.throws(() => restoreBackup(JSON.stringify(badReference)))
})
test('restore rejects missing cards, stale undo pointers and schedules inconsistent with valid feedback', () => {
  let state = fixture()
  state = rate(state, nextTask(state, now)!, Rating.Good, now, false)
  state = rate(state, nextTask(state, now)!, Rating.Good, now, true)
  const missingCards = structuredClone(state)
  missingCards.cards = {}
  assert.throws(() => restoreBackup(JSON.stringify(missingCards)), /备份/)
  const staleUndo = structuredClone(state)
  staleUndo.undoableLogId = staleUndo.logs[0].id
  assert.throws(() => restoreBackup(JSON.stringify(staleUndo)), /备份/)
  const wrongSchedule = structuredClone(state)
  wrongSchedule.cards['w0:read'].schedule!.due = '2030-01-01T00:00:00.000Z'
  assert.throws(() => restoreBackup(JSON.stringify(wrongSchedule)), /备份/)
  assert.equal(restoreBackup(JSON.stringify(state)).logs.length, 2)
  assert.doesNotThrow(() =>
    restoreBackup(JSON.stringify(undo(state, new Date(now.getTime() + 1000)))),
  )
})
