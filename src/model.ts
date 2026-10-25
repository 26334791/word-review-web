import type { Card } from 'ts-fsrs'

export type Direction = 'read' | 'listen'
export type StoredCard = Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string }
export interface Book {
  id: string
  title: string
  publisher: string
  grade: number
  semester: string
  startGrade: number
  edition: string
  source: string
  paused: boolean
  contentNote?: string
}
export interface Word {
  id: string
  bookId: string
  sourceId: string
  en: string
  zh: string
  pos: string
  phonetic: string
  units: string[]
  order: number
  audio: string
  example: string
  archived?: boolean
}
export interface ReviewCard {
  id: string
  wordId: string
  direction: Direction
  schedule: StoredCard | null
}
export interface ReviewLog {
  id: string
  cardId: string
  wordId: string
  at: string
  grade: number
  previous: ReviewCard | null
  createdCardId?: string
  undoneAt?: string
}
export interface State {
  schema: 1
  revision: number
  books: Book[]
  words: Word[]
  cards: Record<string, ReviewCard>
  logs: ReviewLog[]
  undoableLogId: string | null
  settings: { dailyNew: number; bookId: string; unit: string; voiceURI: string; speed: number }
}
export function initialState(): State {
  return {
    schema: 1,
    revision: 0,
    books: [],
    words: [],
    cards: {},
    logs: [],
    undoableLogId: null,
    settings: { dailyNew: 10, bookId: '', unit: 'all', voiceURI: '', speed: 1 },
  }
}
