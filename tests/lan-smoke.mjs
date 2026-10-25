import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { Store, createApp } from '../server-dist/app.mjs'
import { initialState } from '../src/model.ts'
import { importBook } from '../src/imports.ts'
import { browserTools } from './browser-tools.mjs'

const host =
  process.env.TEST_LAN_HOST ??
  Object.entries(networkInterfaces())
    .filter(([name]) => !/virtual|bluetooth|loopback|appgate/i.test(name))
    .flatMap(([, entries]) => entries ?? [])
    .find((e) => e.family === 'IPv4' && !e.internal && !e.address.startsWith('169.254.'))?.address
assert.ok(host && host !== '127.0.0.1', 'Set TEST_LAN_HOST to this host’s actual LAN IPv4 address')
const dir = await mkdtemp(join(tmpdir(), 'words-lan-'))
const password = randomBytes(16).toString('hex')
const store = new Store(dir)
await store.createUser('admin', password, true, false)
const alice = await store.createUser('alice', password, false, true)
const bob = await store.createUser('bob', password, false, false)
const server = createApp(store, resolve('dist'))
server.listen(0, '0.0.0.0')
await once(server, 'listening')
const base = `http://${host}:${server.address().port}`
const { chromium, executablePath } = browserTools()
const browser = await chromium.launch({ headless: true, executablePath })
const contextA = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const contextB = await browser.newContext()
const contextC = await browser.newContext({ viewport: { width: 390, height: 844 } })
const pageA = await contextA.newPage(),
  pageB = await contextB.newPage(),
  pageC = await contextC.newPage()
const errors = []
for (const page of [pageA, pageB, pageC]) page.on('pageerror', (e) => errors.push(e.message))
async function login(page, name, secret = password) {
  await page.goto(base)
  await page.locator('[data-form="login"] input[name=username]').fill(name)
  await page.locator('[data-form="login"] input[name=password]').fill(secret)
  await page.getByRole('button', { name: '登录', exact: true }).click()
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const r = await fetch('/api/state', { cache: 'no-store' })
    if (!r.ok) throw Error('State ' + r.status)
    return (await r.json()).state
  })
}
async function importCatalog(page, id) {
  await page.goto(base + '/#library')
  await page.locator(`[data-action="catalog-${id}"]`).click()
  await page.locator('[data-action="commit-import"]').click()
  await page.waitForURL('**/#today')
}
async function prepareRead(page) {
  await page.locator('[data-action="start-study"]').click()
  await page.locator('[data-action="begin-recall"]').click()
  await page.locator('[data-action="reveal"]').click()
}
let nativeSpeechPassed = false
try {
  await login(pageA, 'alice')
  await pageA.locator('[data-form="password"] input[name=currentPassword]').fill(password)
  await pageA.locator('[data-form="password"] input[name=password]').fill(password + 'new')
  await pageA.locator('[data-form="password"] input[name=confirmation]').fill(password + 'new')
  await pageA.getByRole('button', { name: '修改密码并重新登录' }).click()
  await pageA.locator('[data-form="login"]').waitFor()
  await login(pageA, 'alice', password + 'new')
  await pageA.getByTestId('learned-count').waitFor()
  assert.equal(await pageA.evaluate(() => window.isSecureContext), false)
  assert.equal(await pageA.evaluate(() => typeof crypto.subtle), 'undefined')
  const legacy = importBook(
    initialState(),
    {
      id: 'legacy-book',
      title: '旧档案',
      publisher: '自备',
      grade: 4,
      semester: '上册',
      startGrade: 3,
      edition: '自备',
      source: '',
      paused: false,
    },
    [
      {
        en: 'apple',
        zh: '苹果',
        pos: 'n.',
        phonetic: '',
        unit: 'Unit 1',
        sourceId: 'old-apple',
        audio: '',
        example: '',
        sourceRow: 2,
      },
    ],
  )
  await pageA.evaluate(
    (old) =>
      new Promise((yes, no) => {
        const r = indexedDB.open('word-review-v1', 1)
        r.onupgradeneeded = () => r.result.createObjectStore('archive')
        r.onsuccess = () => {
          const db = r.result
          const tx = db.transaction('archive', 'readwrite')
          tx.objectStore('archive').put(old, 'main')
          tx.oncomplete = () => {
            db.close()
            yes()
          }
          tx.onerror = no
        }
      }),
    legacy,
  )
  await pageA.reload()
  await pageA.locator('#migration-confirm').check()
  await pageA.locator('[data-action="migrate"]').click()
  await pageA.waitForFunction(() =>
    document.querySelector('.sidebar-bottom')?.textContent.includes('版本 1'),
  )
  assert.equal((await snapshot(pageA)).words.length, 1)
  const legacyPreserved = await pageA.evaluate(
    () =>
      new Promise((yes) => {
        const r = indexedDB.open('word-review-v1')
        r.onsuccess = () => {
          const db = r.result
          const q = db.transaction('archive').objectStore('archive').get('main')
          q.onsuccess = () => {
            db.close()
            yes(q.result.words.length)
          }
        }
      }),
  )
  assert.equal(legacyPreserved, 1)
  const catalog = JSON.parse(await readFile('dist/data/catalog.json', 'utf8'))
  for (const entry of catalog) await importCatalog(pageA, entry.id)
  console.log('Catalog and migration passed')
  assert.equal((await snapshot(pageA)).words.length, 3734)
  await login(pageB, 'alice', password + 'new')
  await pageB.getByTestId('learned-count').waitFor()
  assert.deepEqual(await snapshot(pageA), await snapshot(pageB))
  await prepareRead(pageA)
  await prepareRead(pageB)
  await pageA.locator('[data-action="rate-3"]').click()
  await pageA.getByRole('heading', { name: '听见声音，想起意思。' }).waitFor()
  await pageB.locator('[data-action="rate-3"]').click()
  await pageB.getByRole('status').filter({ hasText: '另一台设备已更新' }).waitFor()
  assert.equal((await snapshot(pageA)).logs.length, 1)
  await pageA.locator('[data-action="play-task"]').click()
  await pageA.waitForFunction(
    () => !document.querySelector('[data-action="play-task"]')?.disabled,
    {},
    { timeout: 35000 },
  )
  nativeSpeechPassed = await pageA.locator('[data-action="reveal"]').isEnabled()
  if (!nativeSpeechPassed) {
    await pageA.evaluate(() => {
      const fake = new EventTarget()
      fake.getVoices = () => [
        { name: 'Test voice', lang: 'en-GB', voiceURI: 'test-en', localService: true },
      ]
      fake.cancel = () => {}
      fake.speak = (u) => setTimeout(() => u.onend?.(new Event('end')), 20)
      Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true })
    })
    await pageA.locator('[data-action="play-task"]').click()
    await pageA.waitForFunction(() => !document.querySelector('[data-action="reveal"]').disabled)
  }
  await pageA.locator('[data-action="reveal"]').click()
  await pageA.route(
    '**/api/commands',
    async (route) => {
      await route.fetch()
      await route.abort('failed')
    },
    { times: 1 },
  )
  await pageA.locator('[data-action="rate-1"]').click()
  await pageA.locator('[data-action="reconnect"]').waitFor()
  assert.equal((await snapshot(pageA)).logs.length, 2)
  assert.equal(await pageA.locator('[data-action="rate-3"]').isDisabled(), true)
  await pageA.locator('[data-action="reconnect"]').click()
  await pageA.getByRole('heading', { name: '先听一听，跟着读。' }).waitFor()
  assert.equal((await snapshot(pageA)).logs.length, 2)
  await contextA.setOffline(true)
  await pageA.locator('[data-action="reconnect"]').waitFor()
  assert.equal(await pageA.locator('[data-action="rate-3"]').count(), 0)
  await contextA.setOffline(false)
  await pageA.waitForFunction(() => !document.querySelector('[data-action="reconnect"]'))
  await login(pageC, 'bob')
  await importCatalog(pageC, 'bnu-grade4-upper')
  await prepareRead(pageC)
  await pageC.locator('[data-action="rate-4"]').click()
  await pageC.getByRole('heading', { name: '听见声音，想起意思。' }).waitFor()
  assert.equal((await snapshot(pageC)).logs.length, 1)
  assert.equal((await snapshot(pageA)).logs.length, 2)
  assert.equal((await snapshot(pageC)).books.length, 1)
  await pageA.goto(base + '/#settings')
  const download = pageA.waitForEvent('download')
  await pageA.locator('[data-action="backup"]').click()
  const backup = JSON.parse(await readFile(await (await download).path(), 'utf8'))
  assert.equal(backup.logs.length, 2)
  await pageA.locator('#backup-file').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schema":99}'),
  })
  await pageA.getByRole('status').filter({ hasText: '备份' }).waitFor()
  assert.equal((await snapshot(pageA)).logs.length, 2)
  await pageA.goto(base + '/#study')
  await pageA.locator('[data-action="undo"]').click()
  assert.equal((await snapshot(pageA)).logs.filter((l) => !l.undoneAt).length, 1)
  await pageB.goto(base + '/#today')
  await pageB.reload()
  await pageB.getByTestId('learned-count').waitFor()
  assert.deepEqual(await snapshot(pageA), await snapshot(pageB))
  await pageC.goto(base + '/#settings')
  await pageC.locator('#daily-new').fill('1')
  await pageC.locator('#daily-new').press('Tab')
  await pageC.waitForFunction(
    async () => (await (await fetch('/api/state')).json()).state.settings.dailyNew === 1,
  )
  assert.equal((await snapshot(pageA)).settings.dailyNew, 10)
  await pageC.goto(base + '/#import')
  await pageC.locator('summary').click()
  const draft = '英文,释义\napple,苹果'
  await pageC.locator('#paste-table').fill(draft)
  await pageC.locator('#meta-title').fill('自备词表')
  await pageC.locator('#meta-title').press('Tab')
  assert.equal(await pageC.locator('#paste-table').inputValue(), draft)
  await pageC
    .locator('#paste-table')
    .fill(
      '英文,释义\n"<img src=x onerror=window.__xss=1>",原样文本\nhello,\n"look, out","注意, 小心"',
    )
  await pageC.locator('[data-action="preview-paste"]').click()
  assert.equal(await pageC.locator('img[src=x]').count(), 0)
  assert.equal(await pageC.evaluate(() => window.__xss), undefined)
  assert.equal(await pageC.locator('[data-action="commit-import"]').isDisabled(), true)
  await pageC.locator('#skip-errors').check()
  await pageC.locator('[data-action="commit-import"]').click()
  await pageC.getByTestId('learned-count').waitFor()
  assert.equal((await snapshot(pageC)).words.length, 99)
  await pageC.goto(base + '/#settings')
  await pageC.locator('#backup-file').setInputFiles({
    name: 'restore.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  await pageC.locator('#restore-confirm').check()
  await pageC.locator('[data-action="restore"]').click()
  await pageC.getByRole('status').filter({ hasText: '已恢复教材与复习记录' }).waitFor()
  assert.equal((await snapshot(pageC)).words.length, 3734)
  assert.deepEqual((await snapshot(pageC)).logs, backup.logs)
  assert.equal(await pageC.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await pageC.evaluate(() => {
    const original = Blob.prototype.text
    window.__deferredReads = []
    window.__finishedReads = 0
    Blob.prototype.text = async function () {
      const text = await original.call(this)
      if (this.name?.startsWith('private-'))
        await new Promise((resolve) => window.__deferredReads.push(resolve))
      if (this.name?.startsWith('private-')) window.__finishedReads++
      return text
    }
  })
  await pageC.locator('#backup-file').setInputFiles({
    name: 'private-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  await pageC.locator('a[href="#import"]').click()
  await pageC.locator('#word-file').setInputFiles({
    name: 'private-source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('英文,释义\nsecret-private-word,私人释义'),
  })
  await pageC.waitForFunction(() => window.__deferredReads.length === 2)
  await pageC.locator('nav a[href="#account"]').click()
  await pageC.locator('[data-action="logout"]').click()
  await pageC.locator('[data-form="login"] input[name=username]').fill('admin')
  await pageC.locator('[data-form="login"] input[name=password]').fill(password)
  await pageC.getByRole('button', { name: '登录', exact: true }).click()
  await pageC.getByRole('heading', { name: '账号管理', exact: true }).waitFor()
  await pageC.evaluate(() => window.__deferredReads.forEach((resolve) => resolve()))
  await pageC.waitForFunction(() => window.__finishedReads === 2)
  await pageC.locator('a[href="#import"]').click()
  await pageC.locator('#word-file').waitFor({ state: 'attached' })
  assert.equal(
    await pageC.getByText('secret-private-word', { exact: true }).count(),
    0,
    'Old async import must not appear in the next account',
  )
  await pageC.locator('a[href="#settings"]').click()
  await pageC.locator('#backup-file').waitFor({ state: 'attached' })
  assert.equal(
    await pageC.locator('#restore-confirm').count(),
    0,
    'Old async backup must not appear in the next account',
  )
  await pageC.locator('nav a[href="#account"]').click()
  await pageC.locator('[data-form="create-user"] input[name=username]').fill('created-via-ui')
  await pageC.locator('[data-form="create-user"] input[name=password]').fill(password)
  await pageC.getByRole('button', { name: '创建账号', exact: true }).click()
  await pageC.locator('.account-list').filter({ hasText: 'created-via-ui' }).waitFor()
  await mkdir('artifacts', { recursive: true })
  await pageA.screenshot({ path: 'artifacts/lan-desktop.png', fullPage: true })
  await pageC.screenshot({ path: 'artifacts/lan-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  await writeFile(
    'artifacts/lan-results.json',
    JSON.stringify(
      {
        base,
        accounts: 2,
        devicesForAlice: 2,
        catalogBooks: 16,
        totalWords: 3734,
        nativeSpeechPassed,
        secureContext: false,
        checks: [
          'first-password',
          'legacy-migration-preserved',
          'all-catalog-imports',
          'conflict',
          'lost-response-confirmation',
          'offline-pause',
          'two-account-isolation',
          'backup',
          'invalid-backup',
          'undo',
          'HTTP-UUID-SHA',
        ],
        errors,
      },
      null,
      2,
    ),
  )
  console.log('LAN browser checks passed:', base, 'native speech:', nativeSpeechPassed)
} finally {
  const beforeClose = [store.state(alice.id), store.state(bob.id)]
  await browser.close()
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
  store.close()
  const reopened = new Store(dir)
  assert.deepEqual(reopened.state(alice.id), beforeClose[0])
  assert.deepEqual(reopened.state(bob.id), beforeClose[1])
  reopened.close()
  await rm(dir, { recursive: true, force: true })
}
