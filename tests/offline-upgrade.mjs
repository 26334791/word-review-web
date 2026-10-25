import assert from 'node:assert/strict'
import { mkdtemp, cp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { Store, createApp } from '../server-dist/app.mjs'
import { browserTools } from './browser-tools.mjs'

const dir = await mkdtemp(join(tmpdir(), 'words-upgrade-'))
await cp('dist', join(dir, 'dist'), { recursive: true })
await writeFile(
  join(dir, 'dist/sw.js'),
  `const CACHE='word-review-shell-old-test';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.method==='GET')event.respondWith((async()=>{const cache=await caches.open(CACHE);const saved=await cache.match(event.request);if(saved)return saved;const response=await fetch(event.request);await cache.put(event.request,response.clone());return response})())});`,
)
const store = new Store(join(dir, 'data'))
await store.createUser('admin', 'upgrade-test-password', true, false)
const server = createApp(store, join(dir, 'dist'))
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
const { chromium, executablePath } = browserTools(),
  browser = await chromium.launch({ headless: true, executablePath })
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.error(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  page.on('response', (response) => {
    if (response.status() >= 400) console.error(response.status(), response.url())
  })
  await page.goto(base)
  await page.locator('[data-form=login]').waitFor()
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    await new Promise((resolve) => {
      if (navigator.serviceWorker.controller) resolve()
      else navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
    })
    await (
      await caches.open('word-review-shell-old-test')
    ).put(
      '/api/me',
      new Response(
        JSON.stringify({
          user: { id: 'other-user', username: 'CACHED-PRIVATE-USER', mustChange: false },
        }),
      ),
    )
    await caches.open('unrelated-app-cache')
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('word-review-v1', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('archive')
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction('archive', 'readwrite')
        tx.objectStore('archive').put({ books: [{ id: 'legacy' }], words: [] }, 'main')
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = reject
      }
    })
  })
  await page.reload()
  await page.locator('[data-form=login]').waitFor()
  await page.waitForFunction(() => !navigator.serviceWorker.controller)
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['unrelated-app-cache'])
  assert.equal(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    0,
  )
  assert.equal(await page.getByText('CACHED-PRIVATE-USER').count(), 0)
  const preserved = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open('word-review-v1')
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction('archive').objectStore('archive').get('main')
          q.onsuccess = () => {
            db.close()
            resolve(q.result.books[0].id)
          }
        }
      }),
  )
  assert.equal(preserved, 'legacy')
  await mkdir('artifacts', { recursive: true })
  await writeFile(
    'artifacts/offline-upgrade-results.json',
    JSON.stringify(
      {
        passed: true,
        legacyIndexedDBPreserved: true,
        onlyOwnCacheRemoved: true,
        noCachedAccount: true,
        noServiceWorker: true,
      },
      null,
      2,
    ),
  )
  console.log('Old Service Worker upgrade passed; legacy IndexedDB preserved.')
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
  store.close()
  await rm(dir, { recursive: true, force: true })
}
