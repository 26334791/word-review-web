import './style.css'
import readXlsxFile from 'read-excel-file/browser'
import { initialState } from './model.ts'
import type { State, Book } from './model.ts'
import {
  parseText,
  guessMapping,
  previewRows,
  importBook,
  importSummary,
  exportBook,
} from './imports.ts'
import type { Grid, Field } from './imports.ts'
import { nextTask, stats, restoreBackup, dayKey } from './review.ts'
import type { Task } from './review.ts'
import { loadState } from './db.ts'
import { api, ApiFailure, ArchiveSync } from './sync.ts'
import type { Account } from './sync.ts'
import { englishVoices, selectedVoice, speak, stopSpeech } from './speech.ts'

const root = document.querySelector<HTMLDivElement>('#app')!
let user: Account | null = null,
  sync: ArchiveSync | null = null
let accountVersion = 0
let legacy: State | null = null,
  users: Account[] = [],
  connected = false,
  refreshing = false
const now = () => sync?.now() ?? new Date()
let state = initialState(),
  busy = false,
  message = '',
  isError = false
let task: Task | null = null,
  phase: 'teaching' | 'question' | 'answer' = 'question'
let played = false,
  playing = false,
  sessionCount = 0,
  playVersion = 0
const blocked = new Set<string>()
let sheets: { name: string; grid: Grid }[] = [],
  sheetIndex = 0,
  mapping = guessMapping([])
let fileName = '',
  skipErrors = false,
  mergeConfirmed = false,
  importResult = '',
  query = ''
let pasteText = '',
  pasteOpen = false
const sampleBook: Book = {
  id: '',
  title: '北师大版英语 · 四年级上册',
  publisher: '北师大版',
  grade: 4,
  semester: '上册',
  startGrade: 3,
  edition: '版次待核对',
  source: 'https://github.com/lilinji/English',
  paused: false,
}
let draftBook = { ...sampleBook }
interface CatalogEntry extends Omit<Book, 'paused'> {
  file: string
  rows: number
  sha256: string
  verification: Record<'edition' | 'units' | 'meanings', string>
}
let catalog: CatalogEntry[] = []
let restoreCandidate: State | null = null
const labels: Record<Field, string> = {
  en: '英文',
  zh: '释义',
  phonetic: '音标',
  pos: '词性',
  unit: '单元',
  audio: '发音地址',
  sourceId: '稳定标识',
  example: '例句',
}
const esc = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const icon = (name: string) =>
  `<span class="icon" aria-hidden="true">${({ home: '◷', library: '▤', import: '↥', settings: '⚙' } as Record<string, string>)[name] ?? name}</span>`
const route = () =>
  ['today', 'study', 'library', 'import', 'settings', 'account'].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : 'today'
const btn = (action: string, text: string, cls = 'primary', disabled = false) =>
  `<button class="${cls}" data-action="${action}" ${disabled || busy || ((!connected || sync?.pending) && !['reconnect', 'logout', 'dismiss', 'backup'].includes(action)) ? 'disabled' : ''}>${text}</button>`
const option = (value: string | number, text: string, selected: string | number) =>
  `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(text)}</option>`
function toast(text: string, error = false) {
  message = text
  isError = error
}
function navigate(to: string) {
  location.hash = to
  if (route() === to) render()
}
function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function change(type: string, payload: unknown): Promise<boolean> {
  if (busy || !sync || !connected) return false
  busy = true
  root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => (button.disabled = true))
  try {
    await sync.send(type, payload)
    state = sync.state
    return true
  } catch (error) {
    if (sync.pending) {
      connected = false
      toast('保存结果尚未确认，当前题目已保留。请重新连接后确认，勿重复评分。', true)
    } else {
      state = sync.state
      if (error instanceof ApiFailure && error.status === 409) setTask()
      if (error instanceof ApiFailure && error.status === 401) resetAccount()
      toast(error instanceof Error ? error.message : '保存失败，请重试。', true)
    }
    return false
  } finally {
    busy = false
  }
}
function clearPlayback() {
  playVersion++
  stopSpeech()
  playing = false
  played = false
}
function setTask() {
  clearPlayback()
  task = nextTask(state, now(), blocked)
  phase = task?.kind === 'new' ? 'teaching' : 'question'
}
function dateText(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
function bookTitle(id: string) {
  return state.books.find((b) => b.id === id)?.title ?? '教材'
}
const contentNote = (book?: Book) =>
  book?.contentNote || '自备或旧候选词表：版次、单元和课内释义尚未记录核验结果。'
function catalogView() {
  return `<section class="panel" id="textbook-catalog"><div class="panel-heading"><div><h2>北师大版分册目录</h2><p class="muted small">小学三年级起点 · 四至六年级；初中系列 · 七至九年级。2024新版四上、四下、五上、六上及八上与旧版分别保存。</p></div><span class="tag green">${catalog.length} 册已收录</span></div>
    <div class="catalog-grid">${catalog.map((entry) => `<article class="catalog-book"><h3>${esc(entry.title)}</h3><p class="muted small">${esc(entry.edition)} · ${entry.rows} 个词条</p><p class="small">版次：待版权页核验<br>单元：${entry.verification.units === 'checked' ? '已对照课本' : '待核验'} · 释义：${entry.verification.meanings === 'checked' ? '已对照课本' : '候选词典释义'}</p><p class="muted small">${esc(entry.contentNote)}</p><button class="secondary" data-action="catalog-${esc(entry.id)}" ${busy ? 'disabled' : ''}>预览并导入</button> <a class="text-link small" href="${esc(entry.file)}" download>下载 CSV</a></article>`).join('')}</div>${catalog.length ? '' : '<p>目录暂时无法读取，请联网刷新；已导入的学习档案仍可使用。</p>'}</section>`
}
async function loadCatalog(id: string) {
  const version = accountVersion
  const entry = catalog.find((b) => b.id === id)
  if (!entry) throw new Error('分册目录暂时不可用，请刷新重试。')
  clearPlayback()
  const { csv } = await api('catalog/' + entry.id, undefined, user!.id)
  if (
    version !== accountVersion ||
    !(await openFile(new Blob([csv]), entry.title + '.csv')) ||
    version !== accountVersion
  )
    return
  const { title, publisher, grade, semester, startGrade, edition, source, contentNote } = entry
  draftBook = {
    id: '',
    title,
    publisher,
    grade,
    semester,
    startGrade,
    edition,
    source,
    contentNote,
    paused: false,
  }
  navigate('import')
  render()
}

function render() {
  const pastePanel = root.querySelector<HTMLDetailsElement>('#paste-panel')
  if (user && pastePanel) pasteOpen = pastePanel.open
  if (!user || user.mustChange) {
    renderLogin()
    return
  }
  const current = route(),
    summary = stats(state, now())
  root.innerHTML = `<div class="layout"><aside class="sidebar"><a class="brand" href="#today"><img src="/icon.svg" alt=""><div>单词日课<small>让每一次回忆都有收获</small></div></a>
    <div class="nav-label">我的学习</div><nav aria-label="主导航">${[
      ['today', 'home', '今日学习'],
      ['library', 'library', '教材词库'],
      ['import', 'import', '导入词表'],
      ['settings', 'settings', '设置与备份'],
      ['account', 'settings', '我的账号'],
    ]
      .map(
        ([link, glyph, label]) =>
          `<a href="#${link}" class="${current === link || (link === 'today' && current === 'study') ? 'active' : ''}">${icon(glyph)}${label}</a>`,
      )
      .join('')}</nav>
    <div class="sidebar-bottom"><span class="local-dot"></span> ${connected ? '档案已连接到局域网主机' : '连接中断，暂停保存'}<small>${esc(user.username)} · 版本 ${state.revision}</small></div></aside>
    <main><header class="topbar"><span>一步一步，记得更牢。</span><span>${dayKey(now())} <a href="#account">${esc(user.username)}</a></span></header>
    ${message ? `<div role="status" class="notice ${isError ? 'error' : 'success'}">${esc(message)}<button data-action="dismiss" aria-label="关闭提示">×</button></div>` : ''}
    ${!connected || sync?.pending ? `<div class="notice error" role="alert">连接中断或保存结果尚未确认，已暂停后续评分。${btn('reconnect', '重新连接并确认', 'secondary')}</div>` : ''}
    ${legacy && state.revision === 0 ? `<section class="panel"><h2>检测到此浏览器的旧档案</h2><p>${legacy.books.length} 本教材 · ${legacy.words.length} 个词条。将迁入账号 <b>${esc(user.username)}</b>，原浏览器档案会保留。</p><label class="check"><input id="migration-confirm" type="checkbox">确认迁入当前账号</label>${btn('migrate', '迁入当前账号', 'secondary')}</section>` : ''}
    ${current === 'today' ? todayView(summary) : current === 'study' ? studyView() : current === 'library' ? libraryView() : current === 'import' ? importView() : current === 'account' ? accountView() : settingsView()}
    <footer>专注听读与回忆 · 复习安排随你的记忆反馈调整</footer></main></div>`
}
function todayView(summary: ReturnType<typeof stats>) {
  const book = state.books.find((b) => b.id === state.settings.bookId)
  const activeCount = state.words.filter((w) => !w.archived).length,
    next = nextTask(state, now(), blocked)
  return `<section class="page-title"><div><p class="eyebrow">TODAY / 今日学习</p><h1>今天，也记住一点新东西。</h1><p class="muted">先温习，再出发。每天的进步，都从一次认真回忆开始。</p></div><a class="text-link" href="#settings">调整学习计划 ↗</a></section>
    <div class="metrics"><article><span>到期复习 <small>张卡片</small></span><strong data-testid="due-count">${summary.due}</strong><p>看词与听音，分别记忆</p></article><article><span>今日新词 <small>个单词</small></span><strong data-testid="new-count">${summary.newToday}<em> / ${state.settings.dailyNew}</em></strong><p>按教材顺序，稳稳向前</p></article><article><span>累计已学 <small>个单词</small></span><strong data-testid="learned-count">${summary.learned}<em> / ${activeCount}</em></strong><p>每一次回忆，都留有记录</p></article></div>
    <div class="home-grid"><section class="panel daily"><div class="panel-heading"><h2>今天的学习</h2><span class="tag green">先复习 · 再学新词</span></div>${
      activeCount
        ? `<div class="book-picker"><label for="active-book">新词学习教材</label><select id="active-book">${state.books.map((b) => option(b.id, b.title + (b.paused ? '（已暂停）' : ''), state.settings.bookId)).join('')}</select>${unitSelect(book?.id ?? '')}</div><div class="daily-focus"><div class="book-illustration" aria-hidden="true"><span>ENGLISH</span><b>每天<br>一点</b><i>→</i></div><div><p class="eyebrow">${esc(book?.publisher ?? '')} · ${esc(book?.grade ?? '')} 年级</p><h3>${esc(book?.title ?? '选择一本教材')}</h3><p class="muted">${esc(book?.edition ?? '')} · ${book?.startGrade === 3 ? '三年级起点' : '教材系列'}</p><span class="tag amber">请确认与手中课本版次一致</span></div></div>
      <div class="session-note">${summary.pending ? `还有 ${summary.pending} 张听音首练待完成。` : '先读一读，再试着自己想起来。'}${blocked.size ? ` ${blocked.size} 张卡片暂不可练，可在学习页重试。` : ''}</div>${btn('start-study', next ? (summary.learned ? '继续今日学习  →' : '开始今日学习  →') : '查看学习安排  →', 'primary wide')}
      ${summary.nextDue ? `<p class="footnote">下一次复习：${dateText(summary.nextDue)}</p>` : ''}`
        : `<div class="empty-book"><div class="book-illustration" aria-hidden="true"><span>ENGLISH</span><b>从一本<br>课本开始</b><i>＋</i></div><h3>先把你的教材词表放进来</h3><p>已准备北师大版四年级上册课内词表，<br>也可以导入自己的 Excel 或粘贴老师的词表。</p>${btn('load-sample', '导入北师大四上词表')}<a href="#import" class="text-link">导入自己的词表 →</a></div>`
    }</section>
    <aside class="panel learning-tip"><div class="tip-mark">Aa</div><p class="eyebrow">让声音和词义连起来</p><h2>听见，读出，<br>再自己想起来。</h2><ol><li><b>听一遍，跟着读</b><span>留意发音，熟悉词义。</span></li><li><b>先回忆，再揭晓</b><span>给大脑一次自己找答案的机会。</span></li><li><b>如实反馈记忆</b><span>没想起来也没关系，它会再回来。</span></li></ol><p class="footnote">播放与跟读不会自动计为“记住”。</p></aside></div>`
}
function unitSelect(bookId: string) {
  const units = [
    ...new Set(
      state.words.filter((w) => w.bookId === bookId && !w.archived).flatMap((w) => w.units),
    ),
  ]
  return `<label for="active-unit">新词单元</label><select id="active-unit">${option('all', '整册学习', state.settings.unit)}${units.map((unit) => option(unit, unit, state.settings.unit)).join('')}</select>`
}
function studyView() {
  if (!task) {
    const summary = stats(state, now())
    return `<section class="page-title"><div><p class="eyebrow">YOUR PACE</p><h1>这一段，学得不错。</h1><p class="muted">本次已完成 ${sessionCount} 次回忆评分。</p></div></section><section class="panel centered"><div class="done-mark">✓</div><h2>当前没有可练的新任务</h2><p>${summary.pending || summary.due ? `还有 ${summary.due} 张到期卡和 ${summary.pending} 张首练。暂不可练的听音卡可以重试。` : '给记忆一点时间，下次到期再来复习。'}</p>${summary.nextDue ? `<p>下次复习：${dateText(summary.nextDue)}</p>` : ''}<div class="actions">${btn('undo', '撤销上次评分', 'secondary', !state.undoableLogId)}${btn('retry-tasks', '重新检查任务', 'secondary')}<a class="button primary" href="#today">回到今日学习</a></div></section>`
  }
  const teaching = phase === 'teaching',
    answer = phase === 'answer',
    listening = task.direction === 'listen'
  const showWord = teaching || answer || !listening,
    showMeaning = teaching || answer
  return `<section class="study-top"><a href="#today" class="text-link">← 结束本次学习</a><span>本次完成 <b>${sessionCount}</b> 次回忆 ${sessionCount && sessionCount % 10 === 0 ? ' · 可以休息一下' : ''}</span>${btn('undo', '撤销上次评分', 'text-button', !state.undoableLogId)}</section>
    <section class="study-heading"><p class="eyebrow">${esc(bookTitle(task.word.bookId))} · ${esc(task.word.units.join(' / '))}</p><h1>${teaching ? '先听一听，跟着读。' : listening ? '听见声音，想起意思。' : '试着自己读出它。'}</h1><p class="muted">${teaching ? '熟悉发音和释义，再开始回忆。' : '先在脑中找到答案，再点「查看答案」。'}</p></section>
    <section class="panel flashcard" data-testid="flashcard"><span class="tag ${teaching ? 'amber' : 'green'}">${teaching ? '新词学习' : listening ? '听音回忆' : '看词回忆'}${task.kind === 'due' ? ' · 到期复习' : ''}</span>
      ${showWord ? `<h2 class="word" lang="en">${esc(task.word.en)}</h2>` : '<div class="listening-symbol" aria-hidden="true">▂ ▆ █ ▄ ▇ ▂</div><h2 class="listen-title">这次，先用耳朵认识它。</h2>'}
      ${showMeaning && task.word.phonetic ? `<div class="phonetic" lang="en">${esc(task.word.phonetic)}</div>` : ''}
      ${teaching || answer || listening ? `<div class="play-row">${btn('play-task', playing ? '正在播放…' : played ? '再听一遍' : '播放发音', 'audio-button', playing)}<span>${played ? '已播放' : listening ? '播放后再揭晓答案' : '听一遍，试着跟读'} · ${state.settings.speed}×</span></div>` : ''}
      ${showMeaning ? `<div class="meaning" data-testid="meaning">${esc(task.word.zh).replace(/\n/g, '<br>')}</div>${task.word.example ? `<p class="example" lang="en">${esc(task.word.example)}</p>` : ''}` : '<p class="recall-hint">回忆它的读音和意思，暂时不看答案。</p>'}
      <div class="card-divider"></div>${
        teaching
          ? btn('begin-recall', '准备好了，开始回忆', 'primary')
          : !answer
            ? btn('reveal', '查看答案', 'primary', listening && !played)
            : `<p class="rating-hint">回想一下：刚才揭晓之前，你记得怎么样？</p><div class="ratings">${[
                ['1', '忘记', '看答案才想起'],
                ['2', '费力想起', '想了较久 / 发音不确定'],
                ['3', '记得', '正确想起并基本读对'],
                ['4', '很熟', '立刻想起，读音确定'],
              ]
                .map(
                  ([n, label, hint]) =>
                    `<button data-action="rate-${n}" class="rating rating-${n}" ${busy || !connected || sync?.pending ? 'disabled' : ''}><b>${label}</b><span>${hint}</span><small>按 ${n}</small></button>`,
                )
                .join('')}</div>`
      }
    </section><p class="study-footnote">${listening ? btn('skip-audio', '这个发音暂不可用，先练其他词', 'text-button') : '如实反馈就好，遗忘也是学习的一部分。'} · 空格揭晓，R 重播</p>`
}
function libraryView() {
  const selected = state.books.find((b) => b.id === state.settings.bookId)
  const words = state.words.filter(
    (w) =>
      !w.archived &&
      w.bookId === selected?.id &&
      (!query || `${w.en} ${w.zh}`.toLowerCase().includes(query.toLowerCase())),
  )
  return `<section class="page-title"><div><p class="eyebrow">YOUR BOOKS / 教材词库</p><h1>让学习，跟上你的课本。</h1><p class="muted">按分册管理词表，切换教材也会保留之前的复习。</p></div>${btn('browse-catalog', '选择新版 / 添加教材')}</section>
    ${
      state.books.length
        ? `<div class="book-tabs">${state.books.map((book) => `<button class="${selected?.id === book.id ? 'selected' : ''}" data-book="${esc(book.id)}">${esc(book.title)}<small>${esc(book.edition)}</small></button>`).join('')}</div><section class="panel"><div class="panel-heading"><div><h2>${esc(selected?.title)}</h2><p class="muted small">${esc(selected?.publisher)} · ${selected?.startGrade === 3 ? '三年级起点 · ' : ''}${esc(selected?.edition)}</p></div><div class="actions">${btn('export-book', '导出词表', 'secondary')}${btn('pause-book', selected?.paused ? '恢复复习' : '暂停此册复习', 'secondary')}</div></div>
      <div class="source-note">${esc(contentNote(selected))}${selected?.source && /^https:\/\//.test(selected.source) ? ` <a href="${esc(selected.source)}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a>` : ''}</div>
      <div class="search-row"><label for="word-search" class="sr-only">搜索单词或释义</label><input id="word-search" placeholder="搜索英文或中文释义…" value="${esc(query)}"><span>${words.length} 个词条</span></div>
      <div class="table-scroll"><table><thead><tr><th>单词</th><th>释义</th><th>单元</th><th>练习状态</th><th>发音</th></tr></thead><tbody>${words
        .slice(0, 100)
        .map(
          (word) =>
            `<tr><td><b lang="en">${esc(word.en)}</b><small>${esc(word.phonetic)}</small></td><td class="definition-cell">${esc(word.zh)}</td><td>${esc(word.units.join(' / '))}</td><td>${state.cards[`${word.id}:read`]?.schedule ? '已开始学习' : '未学'}</td><td><button class="round-button" data-word-play="${esc(word.id)}" aria-label="播放 ${esc(word.en)}">▷</button></td></tr>`,
        )
        .join(
          '',
        )}</tbody></table></div>${words.length > 100 ? '<p class="footnote">显示前 100 条，搜索可查找全部词条。</p>' : ''}</section>`
        : `<section class="panel centered"><h2>还没有导入教材</h2><p>从下方分册目录开始，或放入你自己的词表。</p>${btn('load-sample', '导入北师大四上词表')}</section>`
    }${catalogView()}`
}
function currentDraftBook(): Book {
  const book = {
    ...draftBook,
    title: draftBook.title.trim(),
    publisher: draftBook.publisher.trim(),
    edition: draftBook.edition.trim() || '版次待核对',
  }
  book.id =
    'book:' +
    encodeURIComponent(
      JSON.stringify([
        book.publisher,
        book.title,
        book.grade,
        book.semester,
        book.startGrade,
        book.edition,
      ]),
    )
  book.paused = state.books.find((b) => b.id === book.id)?.paused ?? false
  return book
}
function importView() {
  const grid = sheets[sheetIndex]?.grid,
    preview = grid ? previewRows(grid, mapping) : null
  let summary = null,
    importError = ''
  const book = currentDraftBook()
  try {
    if (preview?.valid.length) summary = importSummary(state, book, preview.valid)
  } catch (error) {
    importError = (error as Error).message
  }
  return `<section class="page-title"><div><p class="eyebrow">BUILD YOUR LIBRARY / 导入词表</p><h1>把熟悉的教材，带进来。</h1><p class="muted">选来源，检查字段，确认后才会保存到当前账号。</p></div></section>
    <div class="steps"><span class="${!grid ? 'current' : ''}"><b>1</b> 选择来源</span><i>—</i><span class="${grid ? 'current' : ''}"><b>2</b> 字段与预览</span><i>—</i><span><b>3</b> 确认入库</span></div>
    ${importResult ? `<div class="notice success">${esc(importResult)} <a href="#today">去学习 →</a></div>` : ''}
    <section class="panel"><div class="panel-heading"><h2>教材信息</h2><span class="tag amber">新词表默认待核对</span></div><div class="form-grid">
      <label>教材名称<input id="meta-title" value="${esc(draftBook.title)}" maxlength="120"></label><label>出版社或版本<input id="meta-publisher" value="${esc(draftBook.publisher)}" maxlength="100"></label>
      <label>年级<select id="meta-grade">${[4, 5, 6, 7, 8, 9].map((n) => option(n, `${n} 年级`, draftBook.grade)).join('')}</select></label><label>册次<select id="meta-semester">${['上册', '下册', '全一册'].map((n) => option(n, n, draftBook.semester)).join('')}</select></label>
      <label>起始年级<select id="meta-start">${option(3, '三年级起点', draftBook.startGrade)}${option(1, '一年级起点', draftBook.startGrade)}${option(7, '初中系列', draftBook.startGrade)}</select></label><label>版次<input id="meta-edition" placeholder="未知时保留待核对" value="${esc(draftBook.edition)}" maxlength="120"></label>
      <label class="span-2">来源说明或链接<input id="meta-source" value="${esc(draftBook.source)}" maxlength="500"></label></div><p class="source-note">${esc(contentNote(draftBook))} 核对版次后再导入；已有旧候选册将单独保留，复习记录不会自动迁移到新册。</p></section>
    <section class="panel"><div class="panel-heading"><h2>选择词表来源</h2><a href="#library" class="text-link">查看全部 ${catalog.length} 册 →</a></div><div class="import-sources"><label class="file-zone" for="word-file"><span class="upload-symbol">↥</span><b>选择 Excel 或 CSV 文件</b><span>XLSX / CSV / TSV · 最大 10 MB</span><input class="file-input" id="word-file" type="file" accept=".xlsx,.csv,.tsv,.txt"></label><div class="sample-source"><span class="tag green">单元与释义已对照</span><h3>北师大版 · 四年级上册</h3><p>三年级起点 · 97 个课内词条 · 6 个单元<br>2013 审定版；版权页版次年月待核。</p>${btn('load-sample', '导入北师大四上词表', 'secondary')}</div></div>
      <details id="paste-panel" ${pasteOpen ? 'open' : ''}><summary>或者，从表格粘贴词表</summary><label for="paste-table" class="sr-only">粘贴词表</label><textarea id="paste-table" rows="5" placeholder="英文&#9;释义&#9;音标&#9;单元&#10;apple&#9;苹果&#9;/ˈæpəl/&#9;Unit 1">${esc(pasteText)}</textarea><div class="actions">${btn('preview-paste', '预览粘贴词表', 'secondary')}${btn('template', '下载 CSV 模板', 'text-button')}</div></details></section>
    ${
      grid && preview
        ? `<section class="panel" id="import-preview"><div class="panel-heading"><div><h2>检查字段与导入预览</h2><p class="muted small">${esc(fileName)} · ${grid.length - 1} 行数据</p></div>${sheets.length > 1 ? `<label>工作表<select id="sheet-select">${sheets.map((s, i) => option(i, s.name, sheetIndex)).join('')}</select></label>` : ''}</div>
      <div class="mapping-grid">${Object.entries(labels)
        .map(
          ([field, label]) =>
            `<label>${label}${['en', 'zh'].includes(field) ? ' *' : ''}<select data-map="${field}">${option(-1, '不导入此字段', mapping[field as Field])}${grid[0].map((h, i) => option(i, h || `第 ${i + 1} 列`, mapping[field as Field])).join('')}</select></label>`,
        )
        .join('')}</div>
      <div class="preview-stats"><span>有效 <b>${preview.valid.length}</b></span><span>新增 <b>${summary?.added ?? '—'}</b></span><span>已有 / 重复 <b>${summary?.existing ?? '—'}</b></span><span>归档旧词 <b>${summary?.archived ?? '—'}</b></span><span class="${preview.errors.length ? 'danger' : ''}">错误 <b>${preview.errors.length}</b></span></div>
      ${
        preview.errors.length
          ? `<div class="error-list">${preview.errors
              .slice(0, 20)
              .map((e) => `<p>第 ${e.row} 行：${esc(e.message)}</p>`)
              .join(
                '',
              )}${preview.errors.length > 20 ? '<p>仅显示前 20 项，请下载完整错误报告。</p>' : ''}${btn('export-errors', '下载错误报告', 'text-button')}<label class="check"><input id="skip-errors" type="checkbox" ${skipErrors ? 'checked' : ''}>明确跳过这 ${preview.errors.length} 个错误行，导入其他有效词条</label></div>`
          : ''
      }
      ${importError ? `<p class="notice error">${esc(importError)}</p>` : ''}<div class="table-scroll"><table><thead><tr><th>原行号</th><th>英文</th><th>释义</th><th>单元</th></tr></thead><tbody>${preview.valid
        .slice(0, 6)
        .map(
          (row) =>
            `<tr><td>${row.sourceRow}</td><td lang="en">${esc(row.en)}</td><td class="definition-cell">${esc(row.zh)}</td><td>${esc(row.unit || '未分单元')}</td></tr>`,
        )
        .join(
          '',
        )}</tbody></table></div><p class="footnote">预览前 6 个有效词条，导入统计基于全部数据。未提供单元时整册学习，不自动编造单元。</p>
      ${summary && (summary.existing || summary.archived) ? `<label class="check"><input id="confirm-merge" type="checkbox" ${mergeConfirmed ? 'checked' : ''}>确认合并重复项并更新辅助信息；实质内容变化会归档旧词、重新学习。</label>` : ''}
      <div class="import-confirm"><p>教材：<b>${esc(book.title)}</b><br><span class="muted small">${esc(book.edition)} · 词表会保存在当前账号</span></p>${btn('commit-import', `确认导入 ${preview.valid.length} 个有效词条`, 'primary', !summary || !!importError || (!!preview.errors.length && !skipErrors) || (!!summary && !!(summary.existing || summary.archived) && !mergeConfirmed))}</div></section>`
        : ''
    }`
}
function settingsView() {
  const voices = englishVoices(),
    chosen = selectedVoice(state.settings)
  return `<section class="page-title"><div><p class="eyebrow">YOUR PREFERENCES / 设置与备份</p><h1>找到适合自己的节奏。</h1><p class="muted">一次设置，每天轻松开始。</p></div></section><div class="settings-grid"><section class="panel"><h2>学习计划</h2><label class="setting-label" for="daily-new">每天的新词数量</label><div class="quantity"><input id="daily-new" type="number" min="0" max="100" value="${state.settings.dailyNew}"><span>个 / 天</span></div><p class="muted small">0 表示暂时只复习。已学词的听音首练仍会保留。</p><div class="quiet-info">系统根据每次回忆反馈安排下次复习。忘记时如实选择“忘记”，让复习安排更适合你。</div><p class="footnote">学习日：北京时间，每天 00:00 更新今日计数。</p></section>
    <section class="panel"><h2>英语发音</h2><label class="setting-label" for="voice-select">示范音色</label><select id="voice-select">${option('', '自动选择（优先英音）', state.settings.voiceURI)}${voices.map((v) => option(v.voiceURI, `${v.name} · ${v.lang} · ${v.localService ? '本地' : '联网'}`, state.settings.voiceURI)).join('')}</select><label class="setting-label" for="speed-select">播放语速</label><select id="speed-select">${[0.75, 1, 1.25].map((n) => option(n, `${n}× ${n === 1 ? '正常' : n < 1 ? '慢速' : '快速'}`, state.settings.speed)).join('')}</select><div class="voice-status ${chosen ? 'available' : ''}">${chosen ? `● 已检测到 ${esc(chosen.lang)} 音色，${chosen.localService ? '由设备本地提供' : '需要联网'}` : '尚未检测到英语音色。可以刷新音色，或在 Windows 语言设置中添加英语语音。'}</div><div class="actions">${btn('test-voice', '试听发音', 'secondary')}${btn('refresh-voices', '刷新音色', 'text-button')}</div></section></div>
    <section class="panel"><div class="panel-heading"><div><h2>备份你的学习记录</h2><p class="muted small">词库、复习安排和历史记录，一起保存。</p></div>${btn('backup', '导出完整备份', 'primary')}</div><div class="backup-info"><p>档案保存在局域网主机，使用同一账号可在不同设备接续学习。请定期导出个人备份，主机升级时保留 data 目录。</p><label class="button secondary" for="backup-file">选择备份恢复<input id="backup-file" type="file" accept=".json" class="file-input"></label></div>
      ${restoreCandidate ? `<div class="restore-preview"><h3>检查待恢复的档案</h3><p>${restoreCandidate.books.length} 本教材 · ${restoreCandidate.words.filter((w) => !w.archived).length} 个有效词条 · ${restoreCandidate.logs.filter((l) => !l.undoneAt).length} 条评分记录</p><p class="danger">恢复将替换当前账号档案。请先导出当前备份。</p><label class="check"><input id="restore-confirm" type="checkbox">我已保存当前备份，确认替换当前账号档案</label>${btn('restore', '确认整库恢复', 'secondary')}${btn('cancel-restore', '取消', 'text-button')}</div>` : ''}<p class="footnote">音频备份保存来源链接，不包含远程音频文件。恢复后需要联网播放或使用设备语音。</p></section>`
}
async function openFile(file: File | Blob, name: string) {
  const version = accountVersion
  if (file.size > 10 * 1024 * 1024) throw new Error('词表超过 10 MB，请拆分后导入。')
  if (/\.xlsx$/i.test(name)) {
    const parsed = await readXlsxFile(file)
    if (version !== accountVersion) return false
    sheets = parsed
      .filter((s) => s.data.length)
      .map((s) => ({
        name: s.sheet,
        grid: s.data.map((row) => row.map((cell) => String(cell ?? ''))),
      }))
  } else {
    const text = await file.text()
    if (version !== accountVersion) return false
    sheets = [{ name, grid: parseText(text) }]
  }
  if (!sheets.length || sheets[0].grid.length < 2)
    throw new Error('词表为空，请保留表头和至少一行词条。')
  sheetIndex = 0
  fileName = name
  mapping = guessMapping(sheets[0].grid[0])
  skipErrors = false
  mergeConfirmed = false
  importResult = ''
  return true
}
async function playTask() {
  if (!task || playing) return
  const ownVersion = ++playVersion,
    word = task.word
  playing = true
  render()
  try {
    await speak(word.en, state.settings, word.audio)
    if (ownVersion === playVersion) {
      played = true
      toast('已播放示范音，可以跟读并继续回忆。')
    }
  } catch (error) {
    if (ownVersion === playVersion) toast((error as Error).message, true)
  } finally {
    if (ownVersion === playVersion) {
      playing = false
      render()
    }
  }
}
function resetAccount() {
  accountVersion++
  clearPlayback()
  user = null
  sync = null
  state = initialState()
  connected = false
  task = null
  sessionCount = 0
  blocked.clear()
  users = []
  sheets = []
  sheetIndex = 0
  mapping = guessMapping([])
  fileName = ''
  skipErrors = false
  mergeConfirmed = false
  importResult = ''
  query = ''
  pasteText = ''
  pasteOpen = false
  draftBook = { ...sampleBook }
  restoreCandidate = null
}
function passwordForm() {
  return `<form data-form="password" class="account-form"><label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="256"></label><label>新密码（10–256 个字符）<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required></label><label>确认新密码<input name="confirmation" type="password" autocomplete="new-password" required></label><button class="primary" type="submit">修改密码并重新登录</button></form>`
}
function renderLogin() {
  root.innerHTML = `<main class="auth-shell"><section class="panel"><img src="/icon.svg" width="48" alt=""><h1>单词日课</h1><p>${user?.mustChange ? `账号 ${esc(user.username)} 首次登录，请修改初始密码。` : '登录自己的账号，接续听读与科学复习。'}</p>${message ? `<p class="notice ${isError ? 'error' : 'success'}" role="alert">${esc(message)}</p>` : ''}${user?.mustChange ? passwordForm() + btn('logout', '退出账号', 'secondary') : `<form data-form="login" class="account-form"><label>账号<input name="username" autocomplete="username" required maxlength="40"></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button class="primary" type="submit">登录</button></form><p class="muted small">请向管理员领取账号。本服务仅用于可信局域网。</p>`}</section></main>`
}
function accountView() {
  return `<section class="page-title"><div><h1>我的账号</h1><p>${esc(user!.username)}${user!.admin ? ' · 管理员' : ''}</p></div>${btn('logout', '退出账号', 'secondary')}</section><section class="panel"><h2>修改密码</h2>${passwordForm()}</section>${user!.admin ? `<section class="panel"><div class="panel-heading"><h2>账号管理</h2>${btn('refresh-users', '刷新账号', 'secondary')}</div><p class="muted">新账号首次登录须改密。重置密码或停用账号会使原会话失效。</p><form data-form="create-user" class="account-form"><label>新账号<input name="username" required maxlength="40"></label><label>初始密码<input name="password" type="password" minlength="10" maxlength="256" required autocomplete="new-password"></label><label class="check"><input name="admin" type="checkbox">管理员</label><button class="primary" type="submit">创建账号</button></form><div class="account-list">${users.map((u) => `<article><h3>${esc(u.username)} · ${u.admin ? '管理员' : '学习账号'} · ${u.enabled ? '启用' : '停用'}</h3><button class="secondary" data-action="toggle-user" data-id="${esc(u.id)}" data-enabled="${!u.enabled}">${u.enabled ? '停用账号' : '启用账号'}</button><form data-form="reset-password" data-id="${esc(u.id)}" class="account-form"><label>新初始密码<input name="password" type="password" required minlength="10" maxlength="256" autocomplete="new-password"></label><button class="secondary" type="submit">重置密码</button></form></article>`).join('')}</div></section>` : ''}`
}
async function refreshUsers() {
  const version = accountVersion
  if (user?.admin) {
    const result = await api('admin/users', undefined, user.id)
    if (version === accountVersion) users = result.users
  }
}
async function refreshArchive() {
  if (!user || user.mustChange || !sync || busy || refreshing) return
  refreshing = true
  const current = sync,
    oldRevision = state.revision,
    pendingType = current.pending?.type
  try {
    await current.recover()
    if (current !== sync) return
    state = current.state
    connected = true
    if (state.revision !== oldRevision || pendingType) {
      if (pendingType === 'rate') sessionCount++
      setTask()
      if (pendingType === 'import' || pendingType === 'restore' || pendingType === 'migrate') {
        sheets = []
        restoreCandidate = null
      }
      toast(
        pendingType ? '已确认上次操作结果，档案已同步。' : '另一台设备已更新档案，当前练习已刷新。',
      )
    }
    if (
      !document.querySelector('form:focus-within') &&
      (state.revision !== oldRevision ||
        pendingType ||
        root.querySelector('[data-action="reconnect"]'))
    )
      render()
  } catch (error) {
    if (current !== sync) return
    if (error instanceof ApiFailure && error.status === 401) {
      resetAccount()
      toast(error.message, true)
      render()
    } else {
      if (error instanceof ApiFailure && error.state) {
        state = current.state
        setTask()
      }
      connected = false
      toast(error instanceof Error ? error.message : '连接失败，暂停评分。', true)
      render()
    }
  } finally {
    refreshing = false
  }
}
document.addEventListener('submit', async (event) => {
  const form = event.target as HTMLFormElement
  if (!form.dataset.form) return
  event.preventDefault()
  if (busy) return
  const data = new FormData(form),
    kind = form.dataset.form
  busy = true
  form.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true))
  try {
    if (kind === 'login') {
      const result = await api('login', {
        username: data.get('username'),
        password: data.get('password'),
      })
      resetAccount()
      user = result.user
      if (!user!.mustChange) {
        sync = new ArchiveSync(user!.id)
        await sync.recover()
        state = sync.state
        connected = true
        await refreshUsers()
        if (route() === 'study') setTask()
      }
      message = ''
    } else if (kind === 'password') {
      if (data.get('password') !== data.get('confirmation'))
        throw new Error('两次输入的新密码不一致。')
      await api(
        'password',
        { currentPassword: data.get('currentPassword'), password: data.get('password') },
        user!.id,
      )
      resetAccount()
      toast('密码已修改，请使用新密码重新登录。')
    } else if (kind === 'create-user') {
      await api(
        'admin/users',
        {
          username: data.get('username'),
          password: data.get('password'),
          admin: data.get('admin') === 'on',
        },
        user!.id,
      )
      await refreshUsers()
      toast('账号已创建，首次登录须修改密码。')
    } else if (kind === 'reset-password') {
      await api('admin/users/' + form.dataset.id, { password: data.get('password') }, user!.id)
      if (form.dataset.id === user!.id) resetAccount()
      else await refreshUsers()
      toast('密码已重置，原会话已失效。')
    }
  } catch (error) {
    toast((error as Error).message, true)
  } finally {
    busy = false
    render()
  }
})

document.addEventListener('click', async (event) => {
  const version = accountVersion
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-action],[data-book],[data-word-play]',
  )
  if (!button || busy || (button as HTMLButtonElement).disabled) return
  try {
    if (button.dataset.book) {
      if (await change('settings', { bookId: button.dataset.book!, unit: 'all' })) {
        query = ''
        render()
      }
      return
    }
    if (button.dataset.wordPlay) {
      const word = state.words.find((w) => w.id === button.dataset.wordPlay)!
      await speak(word.en, state.settings, word.audio)
      toast('已播放示范音。')
      render()
      return
    }
    const action = button.dataset.action!
    if (action === 'logout') {
      await api('logout', {}, user!.id)
      resetAccount()
      message = ''
      render()
    } else if (action === 'reconnect') await refreshArchive()
    else if (action === 'refresh-users') {
      await refreshUsers()
      render()
    } else if (action === 'toggle-user') {
      await api(
        'admin/users/' + button.dataset.id,
        { enabled: button.dataset.enabled === 'true' },
        user!.id,
      )
      if (button.dataset.id === user!.id) resetAccount()
      else await refreshUsers()
      toast('账号状态已更新。')
      render()
    } else if (action === 'migrate' && legacy) {
      if (!document.querySelector<HTMLInputElement>('#migration-confirm')?.checked)
        throw new Error('请确认迁入当前账号。')
      if (await change('migrate', JSON.stringify(legacy))) {
        toast('旧档案已迁入，原浏览器档案保留。')
        setTask()
      }
      render()
    } else if (action === 'dismiss') {
      message = ''
      render()
    } else if (action === 'load-sample') await loadCatalog('bnu-grade4-upper')
    else if (action === 'browse-catalog')
      document.querySelector('#textbook-catalog')?.scrollIntoView({ behavior: 'smooth' })
    else if (action.startsWith('catalog-')) await loadCatalog(action.slice(8))
    else if (action === 'start-study' || action === 'retry-tasks') {
      if (action === 'retry-tasks') blocked.clear()
      setTask()
      navigate('study')
      render()
    } else if (action === 'play-task') await playTask()
    else if (action === 'begin-recall') {
      clearPlayback()
      phase = 'question'
      message = ''
      render()
    } else if (
      action === 'reveal' &&
      task &&
      phase === 'question' &&
      (task.direction !== 'listen' || played)
    ) {
      phase = 'answer'
      message = ''
      render()
    } else if (action.startsWith('rate-') && task && phase === 'answer') {
      const currentTask = task,
        audioWasPlayed = played
      if (
        await change('rate', {
          task: currentTask,
          grade: Number(action.slice(5)),
          audioPlayed: audioWasPlayed,
        })
      ) {
        sessionCount++
        toast('已保存，本次反馈已用于安排后续复习。')
        setTask()
      }
      render()
    } else if (action === 'skip-audio' && task) {
      blocked.add(task.key)
      toast('这张听音卡已暂时跳过，未提交评分。')
      setTask()
      render()
    } else if (action === 'undo') {
      if (await change('undo', {})) {
        sessionCount = Math.max(0, sessionCount - 1)
        toast('已撤销上一次评分。')
        setTask()
      }
      render()
    } else if (action === 'preview-paste') {
      const text = document.querySelector<HTMLTextAreaElement>('#paste-table')!.value
      sheets = [{ name: '粘贴词表', grid: parseText(text) }]
      draftBook.contentNote = undefined
      sheetIndex = 0
      fileName = '粘贴词表'
      mapping = guessMapping(sheets[0].grid[0] ?? [])
      skipErrors = false
      mergeConfirmed = false
      render()
    } else if (action === 'template')
      download(
        '单词导入模板.csv',
        '\uFEFF标识,英文,释义,音标,词性,单元,发音,例句\nword-1,apple,苹果,/ˈæpəl/,n.,Unit 1,,I like apples.',
        'text/csv;charset=utf-8',
      )
    else if (action === 'commit-import') {
      const preview = previewRows(sheets[sheetIndex].grid, mapping),
        book = currentDraftBook(),
        summary = importSummary(state, book, preview.valid)
      if (preview.errors.length && !skipErrors) throw new Error('请先处理错误行，或明确选择跳过。')
      if ((summary.existing || summary.archived) && !mergeConfirmed)
        throw new Error('请先确认重复词与内容更新处理。')
      if (await change('import', { book, rows: preview.valid })) {
        importResult = `导入完成：新增 ${summary.added} 个词条，处理已有或重复 ${summary.existing} 行，归档旧词 ${summary.archived} 个，跳过错误 ${preview.errors.length} 行。`
        sheets = []
        toast(importResult)
        navigate('today')
      }
      render()
    } else if (action === 'export-errors') {
      const preview = previewRows(sheets[sheetIndex].grid, mapping)
      download(
        '导入错误报告.txt',
        preview.errors.map((e) => `第 ${e.row} 行：${e.message}`).join('\n'),
        'text/plain;charset=utf-8',
      )
    } else if (action === 'export-book')
      download(
        `${bookTitle(state.settings.bookId)}.csv`,
        exportBook(state, state.settings.bookId),
        'text/csv;charset=utf-8',
      )
    else if (action === 'pause-book') {
      if (
        await change('pause', {
          bookId: state.settings.bookId,
          paused: !state.books.find((b) => b.id === state.settings.bookId)!.paused,
        })
      ) {
        toast('教材复习状态已更新，原学习进度保留。')
      }
      render()
    } else if (action === 'test-voice') {
      await speak('Hello. Let us learn a new word today.', state.settings)
      toast('试听已完成，当前英语语音可以播放。')
      render()
    } else if (action === 'refresh-voices') {
      englishVoices()
      toast('已重新检测设备可用音色。')
      render()
    } else if (action === 'backup')
      download(`单词日课备份-${dayKey(new Date())}.json`, JSON.stringify(state, null, 2))
    else if (action === 'cancel-restore') {
      restoreCandidate = null
      render()
    } else if (action === 'restore' && restoreCandidate) {
      if (!document.querySelector<HTMLInputElement>('#restore-confirm')?.checked)
        throw new Error('请先保存当前备份并勾选替换确认。')
      const backup = restoreBackup(JSON.stringify(restoreCandidate))
      if (await change('restore', JSON.stringify(backup))) {
        restoreCandidate = null
        blocked.clear()
        task = null
        toast('已恢复教材与复习记录。')
      }
      render()
    }
  } catch (error) {
    if (version !== accountVersion) return
    toast((error as Error).message, true)
    render()
  }
})
document.addEventListener('change', async (event) => {
  const version = accountVersion
  const input = event.target as HTMLInputElement | HTMLSelectElement
  try {
    if (input.id.startsWith('meta-')) {
      const fields: Record<string, keyof Book> = {
        'meta-title': 'title',
        'meta-publisher': 'publisher',
        'meta-grade': 'grade',
        'meta-semester': 'semester',
        'meta-start': 'startGrade',
        'meta-edition': 'edition',
        'meta-source': 'source',
      }
      const key = fields[input.id]
      draftBook = {
        ...draftBook,
        contentNote: undefined,
        [key]: ['grade', 'startGrade'].includes(key) ? Number(input.value) : input.value,
      }
      render()
      return
    }
    if (input.dataset.map) {
      mapping = { ...mapping, [input.dataset.map]: Number(input.value) }
      draftBook.contentNote = undefined
      mergeConfirmed = false
      render()
      return
    }
    if (input.id === 'sheet-select') {
      sheetIndex = Number(input.value)
      mapping = guessMapping(sheets[sheetIndex].grid[0])
      mergeConfirmed = false
      skipErrors = false
      render()
      return
    }
    if (input.id === 'skip-errors') {
      skipErrors = (input as HTMLInputElement).checked
      render()
      return
    }
    if (input.id === 'confirm-merge') {
      mergeConfirmed = (input as HTMLInputElement).checked
      render()
      return
    }
    if (input.id === 'word-file') {
      const file = (input as HTMLInputElement).files?.[0]
      if (file) {
        if (!(await openFile(file, file.name)) || version !== accountVersion) return
        draftBook.contentNote = undefined
        render()
      }
      return
    }
    if (input.id === 'backup-file') {
      const file = (input as HTMLInputElement).files?.[0]
      if (file) {
        if (file.size > 50 * 1024 * 1024) throw new Error('备份超过 50 MB。')
        const text = await file.text()
        if (version !== accountVersion) return
        restoreCandidate = restoreBackup(text)
        render()
      }
      return
    }
    const settingKey: Record<string, keyof State['settings']> = {
      'active-book': 'bookId',
      'active-unit': 'unit',
      'daily-new': 'dailyNew',
      'voice-select': 'voiceURI',
      'speed-select': 'speed',
    }
    const key = settingKey[input.id]
    if (key) {
      const value = ['dailyNew', 'speed'].includes(key) ? Number(input.value) : input.value
      if (
        key === 'dailyNew' &&
        (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100)
      )
        throw new Error('新词数量须为 0 至 100 的整数。')
      await change('settings', { [key]: value, ...(key === 'bookId' ? { unit: 'all' } : {}) })
      render()
    }
  } catch (error) {
    if (version !== accountVersion) return
    toast((error as Error).message, true)
    render()
  }
})
document.addEventListener(
  'toggle',
  (event) => {
    const panel = event.target as HTMLDetailsElement
    if (panel.id === 'paste-panel' && panel.isConnected) pasteOpen = panel.open
  },
  true,
)
document.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement
  if (input.id === 'paste-table') {
    pasteText = input.value
    return
  }
  if (input.id === 'word-search') {
    query = input.value
    const start = input.selectionStart
    render()
    const replacement = document.querySelector<HTMLInputElement>('#word-search')!
    replacement.focus()
    replacement.setSelectionRange(start, start)
  }
})
document.addEventListener('keydown', (event) => {
  if (
    route() !== 'study' ||
    !task ||
    busy ||
    /INPUT|TEXTAREA|SELECT|BUTTON|A/.test((event.target as HTMLElement).tagName)
  )
    return
  if (event.code === 'Space') {
    event.preventDefault()
    if (phase === 'question')
      document.querySelector<HTMLButtonElement>('[data-action="reveal"]')?.click()
  }
  if (event.key.toLowerCase() === 'r')
    document.querySelector<HTMLButtonElement>('[data-action="play-task"]')?.click()
  if (phase === 'answer' && /^[1-4]$/.test(event.key))
    document.querySelector<HTMLButtonElement>(`[data-action="rate-${event.key}"]`)?.click()
})
window.addEventListener('hashchange', () => {
  clearPlayback()
  if (route() === 'study' && !sync?.pending) setTask()
  render()
})
window.addEventListener('pagehide', stopSpeech)
window.speechSynthesis?.addEventListener('voiceschanged', () => {
  if (route() === 'settings' && !playing) render()
})
window.addEventListener('online', () => {
  void refreshArchive()
})
window.addEventListener('offline', () => {
  connected = false
  render()
})
window.addEventListener('focus', () => {
  void refreshArchive()
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshArchive()
})
setInterval(() => {
  if (!document.hidden) void refreshArchive()
}, 15000)
async function disableOfflineShell() {
  if (!('serviceWorker' in navigator)) return
  const ours = (url: string) =>
    new URL(url).origin === location.origin && new URL(url).pathname === '/sw.js'
  const controlled =
    navigator.serviceWorker.controller && ours(navigator.serviceWorker.controller.scriptURL)
  for (const registration of await navigator.serviceWorker.getRegistrations())
    if (
      [registration.active, registration.waiting, registration.installing].some(
        (worker) => worker && ours(worker.scriptURL),
      )
    )
      await registration.unregister()
  if ('caches' in window)
    for (const key of await caches.keys())
      if (key.startsWith('word-review-shell-')) await caches.delete(key)
  if (controlled && !sessionStorage.getItem('word-offline-upgrade')) {
    sessionStorage.setItem('word-offline-upgrade', '1')
    location.reload()
    return true
  }
  if (!controlled) sessionStorage.removeItem('word-offline-upgrade')
  return false
}
try {
  if (!(await disableOfflineShell())) {
    try {
      const old = await loadState()
      if (old.books.length || old.words.length) legacy = old
    } catch {
      /* Legacy storage can be disabled without blocking server accounts. */
    }
    const response = await fetch('/data/catalog.json', { cache: 'no-store' })
    if (response.ok) catalog = await response.json()
    try {
      user = (await api('me')).user
      if (!user!.mustChange) {
        sync = new ArchiveSync(user!.id)
        await sync.recover()
        state = sync.state
        connected = true
        await refreshUsers()
        if (route() === 'study') setTask()
      }
    } catch (error) {
      if (!(error instanceof ApiFailure && error.status === 401))
        toast((error as Error).message, true)
      if (error instanceof ApiFailure && error.status === 401) resetAccount()
    }
    render()
  }
} catch (error) {
  resetAccount()
  toast('无法连接服务：' + (error as Error).message, true)
  render()
}
