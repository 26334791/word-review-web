import { fsrs, createEmptyCard } from 'ts-fsrs'
import type { Card, Grade } from 'ts-fsrs'
import type { State, Direction, Word, ReviewCard, StoredCard } from './model.ts'
import { safeAudio } from './imports.ts'
import { uuid } from './id.ts'
export interface Task {
  key: string
  word: Word
  direction: Direction
  kind: 'new' | 'first' | 'due'
  revision: number
}
export function dayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false })
function activeWords(state: State): Word[] {
  const availableBooks = new Set(state.books.filter((b) => !b.paused).map((b) => b.id))
  return state.words.filter((w) => !w.archived && availableBooks.has(w.bookId))
}
export function stats(state: State, now: Date) {
  const first = new Map<string, string>()
  for (const log of state.logs)
    if (!log.undoneAt && (!first.has(log.wordId) || log.at < first.get(log.wordId)!))
      first.set(log.wordId, log.at)
  const activeIds = new Set(activeWords(state).map((w) => w.id))
  const cards = Object.values(state.cards).filter((c) => activeIds.has(c.wordId))
  const future = cards
    .filter((c) => c.schedule && Date.parse(c.schedule.due) > now.getTime())
    .map((c) => c.schedule!.due)
    .sort()
  return {
    newToday: [...first.values()].filter((at) => dayKey(new Date(at)) === dayKey(now)).length,
    learned: state.words.filter((w) => !w.archived && first.has(w.id)).length,
    due: cards.filter((c) => c.schedule && Date.parse(c.schedule.due) <= now.getTime()).length,
    pending: cards.filter((c) => !c.schedule).length,
    nextDue: future[0] ?? null,
  }
}
export function nextTask(state: State, now: Date, blocked = new Set<string>()): Task | null {
  const active = activeWords(state)
  const wordMap = new Map(active.map((w) => [w.id, w]))
  const cards = Object.values(state.cards).filter(
    (c) => wordMap.has(c.wordId) && !blocked.has(c.id),
  )
  const due = cards
    .filter((c) => c.schedule && Date.parse(c.schedule.due) <= now.getTime())
    .sort((a, b) => a.schedule!.due.localeCompare(b.schedule!.due))[0]
  const chosen = due ?? cards.find((c) => !c.schedule)
  if (chosen)
    return {
      key: chosen.id,
      word: wordMap.get(chosen.wordId)!,
      direction: chosen.direction,
      kind: due ? 'due' : 'first',
      revision: state.revision,
    }
  if (stats(state, now).newToday >= state.settings.dailyNew) return null
  const word = active
    .filter(
      (w) =>
        w.bookId === state.settings.bookId &&
        (state.settings.unit === 'all' || w.units.includes(state.settings.unit)),
    )
    .sort((a, b) => a.order - b.order)
    .find((w) => !state.cards[`${w.id}:read`] && !blocked.has(`${w.id}:read`))
  return word
    ? { key: `${word.id}:read`, word, direction: 'read', kind: 'new', revision: state.revision }
    : null
}
function fromStored(card: StoredCard): Card {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  }
}
export function rate(
  state: State,
  task: Task,
  grade: number,
  now: Date,
  audioPlayed: boolean,
): State {
  if (!task || task.revision !== state.revision) throw new Error('档案已更新，请刷新当前练习。')
  if (![1, 2, 3, 4].includes(grade) || !Number.isFinite(now.getTime()))
    throw new Error('评分或时间无效。')
  const word = activeWords(state).find((w) => w.id === task.word.id)
  if (
    !word ||
    task.key !== `${word.id}:${task.direction}` ||
    !['read', 'listen'].includes(task.direction)
  )
    throw new Error('该词已暂停或更新，请重新开始练习。')
  if (task.direction === 'listen' && !audioPlayed)
    throw new Error('请先成功播放单词，再提交听音评分。')
  const previous = state.cards[task.key] ?? null
  if (!previous && task.direction !== 'read') throw new Error('请先完成看词回忆。')
  if (!previous && stats(state, now).newToday >= state.settings.dailyNew)
    throw new Error('今日新词额度已用完。')
  if (previous?.schedule && Date.parse(previous.schedule.due) > now.getTime())
    throw new Error('该卡尚未到期，请稍后复习。')
  const latest = state.logs.filter((l) => !l.undoneAt).at(-1)
  if (latest && Date.parse(latest.at) > now.getTime())
    throw new Error('设备时间早于上次学习，请校准系统时间。')
  const card = previous?.schedule ? fromStored(previous.schedule) : createEmptyCard(now)
  const result = scheduler.next(card, now, grade as Grade)
  const next = structuredClone(state)
  next.cards[task.key] = {
    id: task.key,
    wordId: word.id,
    direction: task.direction,
    schedule: JSON.parse(JSON.stringify(result.card)),
  }
  const log = {
    id: uuid(),
    cardId: task.key,
    wordId: word.id,
    at: now.toISOString(),
    grade,
    previous: previous ? structuredClone(previous) : null,
    createdCardId: undefined as string | undefined,
  }
  if (!previous) {
    const listenId = `${word.id}:listen`
    next.cards[listenId] = { id: listenId, wordId: word.id, direction: 'listen', schedule: null }
    log.createdCardId = listenId
  }
  next.logs.push(log)
  next.undoableLogId = log.id
  return next
}
export function undo(state: State, now: Date): State {
  const log = state.logs.find((l) => l.id === state.undoableLogId && !l.undoneAt)
  if (!log) throw new Error('没有可以撤销的评分。')
  const next = structuredClone(state)
  if (log.previous) next.cards[log.cardId] = structuredClone(log.previous)
  else delete next.cards[log.cardId]
  if (log.createdCardId) delete next.cards[log.createdCardId]
  next.logs.find((l) => l.id === log.id)!.undoneAt = now.toISOString()
  next.undoableLogId = null
  return next
}
export function restoreBackup(text: string): State {
  if (new TextEncoder().encode(text).length > 50 * 1024 * 1024) throw new Error('备份超过 50 MB。')
  const state = JSON.parse(text) as State
  const fail = () => {
    throw new Error('备份格式或数据关联无效，当前档案未修改。')
  }
  const string = (value: unknown) => typeof value === 'string' && value.length < 100000
  const date = (value: unknown) => string(value) && Number.isFinite(Date.parse(value as string))
  const scheduleValid = (schedule: StoredCard | null): boolean =>
    schedule === null ||
    (typeof schedule === 'object' &&
      !!schedule &&
      date(schedule.due) &&
      (schedule.last_review === undefined || date(schedule.last_review)) &&
      [
        'stability',
        'difficulty',
        'elapsed_days',
        'scheduled_days',
        'reps',
        'lapses',
        'state',
        'learning_steps',
      ].every(
        (k) =>
          typeof (schedule as unknown as Record<string, unknown>)[k] === 'number' &&
          Number.isFinite((schedule as unknown as Record<string, number>)[k]) &&
          (schedule as unknown as Record<string, number>)[k] >= 0,
      ) &&
      [0, 1, 2, 3].includes(schedule.state))
  if (
    !state ||
    state.schema !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.books) ||
    !Array.isArray(state.words) ||
    !Array.isArray(state.logs) ||
    !state.cards ||
    typeof state.cards !== 'object' ||
    Array.isArray(state.cards) ||
    !state.settings
  )
    fail()
  const books = new Set<string>(),
    words = new Set<string>(),
    logIds = new Set<string>()
  for (const book of state.books) {
    if (
      !book ||
      !string(book.id) ||
      !book.id ||
      books.has(book.id) ||
      !string(book.title) ||
      !string(book.publisher) ||
      !Number.isInteger(book.grade) ||
      book.grade < 1 ||
      book.grade > 12 ||
      !string(book.semester) ||
      !Number.isInteger(book.startGrade) ||
      !string(book.edition) ||
      !string(book.source) ||
      typeof book.paused !== 'boolean'
    )
      fail()
    books.add(book.id)
  }
  for (const word of state.words) {
    if (
      !word ||
      !string(word.id) ||
      !word.id ||
      words.has(word.id) ||
      !books.has(word.bookId) ||
      !string(word.sourceId) ||
      !string(word.en) ||
      !word.en.trim() ||
      !string(word.zh) ||
      !word.zh.trim() ||
      !string(word.pos) ||
      !string(word.phonetic) ||
      !string(word.example) ||
      !string(word.audio) ||
      !safeAudio(word.audio) ||
      !Array.isArray(word.units) ||
      !word.units.length ||
      !word.units.every(string) ||
      !Number.isFinite(word.order) ||
      (word.archived !== undefined && typeof word.archived !== 'boolean')
    )
      fail()
    words.add(word.id)
  }
  const cardValid = (card: ReviewCard, key: string) =>
    card &&
    words.has(card.wordId) &&
    ['read', 'listen'].includes(card.direction) &&
    card.id === key &&
    key === `${card.wordId}:${card.direction}` &&
    scheduleValid(card.schedule)
  for (const [key, card] of Object.entries(state.cards)) if (!cardValid(card, key)) fail()
  for (const log of state.logs) {
    if (
      !log ||
      !string(log.id) ||
      logIds.has(log.id) ||
      !words.has(log.wordId) ||
      ![`${log.wordId}:read`, `${log.wordId}:listen`].includes(log.cardId) ||
      !date(log.at) ||
      ![1, 2, 3, 4].includes(log.grade) ||
      (log.undoneAt !== undefined && !date(log.undoneAt)) ||
      (log.previous !== null && !cardValid(log.previous, log.cardId)) ||
      (log.createdCardId !== undefined && log.createdCardId !== `${log.wordId}:listen`)
    )
      fail()
    logIds.add(log.id)
  }
  const settings = state.settings
  if (
    !Number.isInteger(settings.dailyNew) ||
    settings.dailyNew < 0 ||
    settings.dailyNew > 100 ||
    !string(settings.bookId) ||
    (settings.bookId && !books.has(settings.bookId)) ||
    !string(settings.unit) ||
    !string(settings.voiceURI) ||
    ![0.75, 1, 1.25].includes(settings.speed) ||
    (state.undoableLogId !== null && !logIds.has(state.undoableLogId))
  )
    fail()
  const latestLog = state.logs.at(-1)
  if (
    state.undoableLogId !== null &&
    (!latestLog || latestLog.undoneAt || latestLog.id !== state.undoableLogId)
  )
    fail()
  const fields = [
    'due',
    'last_review',
    'stability',
    'difficulty',
    'elapsed_days',
    'scheduled_days',
    'reps',
    'lapses',
    'state',
    'learning_steps',
  ] as const
  const canonical = (card: ReviewCard | null) =>
    JSON.stringify(
      card
        ? [
            card.id,
            card.wordId,
            card.direction,
            card.schedule ? fields.map((field) => card.schedule![field] ?? null) : null,
          ]
        : null,
    )
  const replayed: Record<string, ReviewCard> = {}
  let previousTime = -Infinity
  for (const log of state.logs) {
    if (log.undoneAt) continue
    const at = new Date(log.at),
      current = replayed[log.cardId] ?? null
    if (at.getTime() < previousTime || canonical(current) !== canonical(log.previous)) fail()
    previousTime = at.getTime()
    const firstRead = current === null && log.cardId === `${log.wordId}:read`
    if (!current && !firstRead) fail()
    if (firstRead ? log.createdCardId !== `${log.wordId}:listen` : log.createdCardId !== undefined)
      fail()
    if (current?.schedule && Date.parse(current.schedule.due) > at.getTime()) fail()
    const result = scheduler.next(
      current?.schedule ? fromStored(current.schedule) : createEmptyCard(at),
      at,
      log.grade as Grade,
    )
    replayed[log.cardId] = {
      id: log.cardId,
      wordId: log.wordId,
      direction: log.cardId.endsWith(':read') ? 'read' : 'listen',
      schedule: JSON.parse(JSON.stringify(result.card)),
    }
    if (firstRead)
      replayed[`${log.wordId}:listen`] = {
        id: `${log.wordId}:listen`,
        wordId: log.wordId,
        direction: 'listen',
        schedule: null,
      }
  }
  if (
    Object.keys(replayed).length !== Object.keys(state.cards).length ||
    Object.entries(replayed).some(
      ([key, card]) => canonical(card) !== canonical(state.cards[key] ?? null),
    )
  )
    fail()
  return state
}
