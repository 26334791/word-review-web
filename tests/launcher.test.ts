import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isAppRunning } from '../scripts/open-browser.ts'

test('launcher reuses only a ready Word Review page and handles unavailable ports', async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('<title>单词日课</title><link href="/manifest.webmanifest">'),
  )
  assert.equal(await isAppRunning(), true)
  fetchMock.mock.mockImplementation(async () => new Response('<title>Another service</title>'))
  assert.equal(await isAppRunning(), false)
  fetchMock.mock.mockImplementation(async () => {
    throw new Error('Connection refused')
  })
  assert.equal(await isAppRunning(), false)
})

test('Windows batch launcher keeps CRLF endings for cmd.exe parsing', async () => {
  const batch = await readFile('启动网页版.cmd', 'utf8')
  assert.equal(/(^|[^\r])\n/.test(batch), false)
})
