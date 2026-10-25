import Papa from 'papaparse'
import type { Book, State, Word } from './model.ts'
export type Grid = string[][]
export type Field = 'en' | 'zh' | 'pos' | 'phonetic' | 'unit' | 'audio' | 'sourceId' | 'example'
export type Mapping = Record<Field, number>
export interface ImportRow {
  en: string
  zh: string
  pos: string
  phonetic: string
  unit: string
  audio: string
  sourceId: string
  example: string
  sourceRow: number
}
export interface Preview {
  valid: ImportRow[]
  errors: { row: number; message: string }[]
}
export function parseText(text: string): Grid {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024)
    throw new Error('词表超过 10 MB，请拆分后导入。')
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: false })
  const errors = parsed.errors.filter((e) => e.code !== 'UndetectableDelimiter')
  if (errors.length) throw new Error(`词表格式错误：${errors[0].message}`)
  if (parsed.data.length > 20001) throw new Error('单次最多导入 20000 行，请拆分文件。')
  return parsed.data.map((row) => row.map((cell) => String(cell ?? '')))
}
export function guessMapping(headers: string[]): Mapping {
  const aliases: Record<Field, string[]> = {
    en: ['英文', '单词', 'word', 'english', 'en', '单词或短语'],
    zh: ['释义', '中文', '中文释义', 'translation', 'definition', 'meaning', 'zh', '单词释义'],
    pos: ['词性', 'pos'],
    phonetic: ['音标', 'phonetic', 'ipa', '英式音标', '英音'],
    unit: ['单元', 'unit'],
    audio: ['发音', '音频', 'audio', 'audiourl'],
    sourceId: ['标识', 'id', 'sourceid', '稳定标识'],
    example: ['例句', 'example'],
  }
  return Object.fromEntries(
    Object.entries(aliases).map(([field, names]) => [
      field,
      headers.findIndex((h) => names.includes(h.trim().toLowerCase())),
    ]),
  ) as Mapping
}
export function safeAudio(url: string): boolean {
  if (!url) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
  } catch {
    return false
  }
}
export function previewRows(grid: Grid, mapping: Mapping): Preview {
  const result: Preview = { valid: [], errors: [] }
  const selected = Object.values(mapping).filter((i) => i >= 0)
  if (mapping.en < 0 || mapping.zh < 0 || new Set(selected).size !== selected.length) {
    return {
      valid: [],
      errors: [{ row: 1, message: '请选择独立的英文与释义列，各字段不能重复使用同一列。' }],
    }
  }
  if (grid.length > 20001)
    return { valid: [], errors: [{ row: 1, message: '单次最多 20000 行。' }] }
  grid.slice(1).forEach((cells, index) => {
    if (cells.every((c) => !String(c ?? '').trim())) return
    const row = Object.fromEntries(
      Object.entries(mapping).map(([key, column]) => [key, String(cells[column] ?? '').trim()]),
    ) as Omit<ImportRow, 'sourceRow'>
    const sourceRow = index + 2
    if (!row.en || !row.zh)
      result.errors.push({ row: sourceRow, message: '英文和课内释义不能为空。' })
    else if (!safeAudio(row.audio))
      result.errors.push({ row: sourceRow, message: '音频须为不含账号密码的完整 HTTPS 地址。' })
    else result.valid.push({ ...row, sourceRow })
  })
  return result
}
function signature(word: { en: string; zh: string; pos: string }): string {
  return JSON.stringify([word.en, word.zh, word.pos])
}
export function importBook(state: State, book: Book, rows: ImportRow[]): State {
  if (
    !book.title.trim() ||
    !book.publisher.trim() ||
    !Number.isInteger(book.grade) ||
    book.grade < 1 ||
    book.grade > 12 ||
    !book.semester
  )
    throw new Error('请填写完整的教材名称、版本、年级和册次。')
  if (!rows.length) throw new Error('没有可导入的有效词条。')
  const next = structuredClone(state)
  const existingBook = next.books.find((b) => b.id === book.id)
  if (existingBook) Object.assign(existingBook, book)
  else next.books.push({ ...book })
  const getActive = () => next.words.filter((w) => w.bookId === book.id && !w.archived)
  const seenIds = new Map<string, string>()
  const replacedUnits = new Set<string>()
  for (const row of rows) {
    if (!row.en || !row.zh || !safeAudio(row.audio)) throw new Error(`第 ${row.sourceRow} 行无效。`)
    if (row.sourceId && seenIds.has(row.sourceId) && seenIds.get(row.sourceId) !== signature(row))
      throw new Error(`标识 ${row.sourceId} 在同一文件内指向不同内容，请先修正。`)
    if (row.sourceId) seenIds.set(row.sourceId, signature(row))
    let target = row.sourceId
      ? getActive().find((w) => w.sourceId === row.sourceId)
      : getActive().find((w) => signature(w) === signature(row))
    if (target && (target.en !== row.en || target.zh !== row.zh)) {
      target.archived = true
      target = undefined
      next.undoableLogId = null
    }
    if (!target) {
      const id = crypto.randomUUID()
      target = {
        id,
        bookId: book.id,
        sourceId: row.sourceId || id,
        en: row.en,
        zh: row.zh,
        pos: row.pos,
        phonetic: row.phonetic,
        audio: row.audio,
        example: row.example,
        units: [],
        order: next.words.length,
      }
      next.words.push(target)
    }
    Object.assign(target, {
      phonetic: row.phonetic,
      pos: row.pos,
      audio: row.audio,
      example: row.example,
    })
    if (row.sourceId && !replacedUnits.has(target.id)) {
      target.units = []
      replacedUnits.add(target.id)
    }
    const unit = row.unit || '未分单元'
    if (!target.units.includes(unit)) target.units.push(unit)
  }
  // A source-level verification note cannot describe extra words retained by a merge.
  const imported = new Map(rows.map((row) => [row.sourceId, signature(row)]))
  const savedBook = next.books.find((b) => b.id === book.id)!
  if (
    savedBook.contentNote &&
    !getActive().every((word) => imported.get(word.sourceId) === signature(word))
  )
    savedBook.contentNote = undefined
  next.settings.bookId = book.id
  next.settings.unit = 'all'
  return next
}
export function importSummary(state: State, book: Book, rows: ImportRow[]) {
  const next = importBook(state, book, rows)
  return {
    added: next.words.length - state.words.length,
    archived:
      next.words.filter((w) => w.archived).length - state.words.filter((w) => w.archived).length,
    existing: rows.length - (next.words.length - state.words.length),
  }
}
export function exportBook(state: State, bookId: string): string {
  const words = state.words.filter((w) => w.bookId === bookId && !w.archived)
  const rows = words.flatMap((word) =>
    word.units.map((unit) => ({
      标识: word.sourceId,
      英文: word.en,
      释义: word.zh,
      词性: word.pos,
      音标: word.phonetic,
      单元: unit,
      发音: word.audio,
      例句: word.example,
    })),
  )
  return '\uFEFF' + Papa.unparse(rows, { escapeFormulae: true })
}
