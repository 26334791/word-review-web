import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'

test(
  'portable server serves exact catalog assets and rejects paths outside dist',
  { timeout: 15000 },
  async () => {
    const child = spawn(process.execPath, ['scripts/serve.mjs', '--port', '0', '--no-browser'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (data) => {
      output += data
    })
    try {
      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(output || 'Startup timeout')), 5000)
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.once('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`Exited ${code}: ${output}`))
        })
        child.stdout.on('data', (data) => {
          output += data
          const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//)
          if (match) {
            clearTimeout(timer)
            resolve(match[0])
          }
        })
      })
      const html = await fetch(url)
      assert.equal(html.status, 200)
      assert.match(await html.text(), /<title>单词日课<\/title>/)
      assert.match(html.headers.get('content-type'), /text\/html/)
      assert.equal(html.headers.get('cache-control'), 'no-cache')
      const catalog = await (await fetch(url + 'data/catalog.json')).json()
      assert.equal(catalog.length, 16)
      for (const book of catalog) {
        const response = await fetch(new URL(book.file, url))
        assert.equal(response.status, 200)
        assert.equal(
          createHash('sha256')
            .update(new Uint8Array(await response.arrayBuffer()))
            .digest('hex'),
          book.sha256,
        )
      }
      const head = await fetch(url + 'manifest.webmanifest', { method: 'HEAD' })
      assert.match(head.headers.get('content-type'), /application\/manifest\+json/)
      assert.equal(await head.text(), '')
      assert.equal((await fetch(url + 'missing.txt')).status, 404)
      assert.equal((await fetch(url + '..%2fpackage.json')).status, 403)
      assert.equal((await fetch(url + '%00')).status, 400)
      assert.equal((await fetch(url + '%zz')).status, 400)
      assert.equal((await fetch(url, { method: 'POST' })).status, 405)
    } finally {
      if (child.exitCode === null) {
        const stopped = once(child, 'close')
        child.kill()
        await stopped
      }
    }
  },
)
