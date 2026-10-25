import test from 'node:test'
import assert from 'node:assert/strict'
import { ArchiveSync } from '../src/sync.ts'
import { initialState } from '../src/model.ts'

test('server failure leaves an operation pending; delayed snapshots cannot roll back state', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'server error' }), { status: 500 })
  try {
    const sync = new ArchiveSync('user-server-error')
    await assert.rejects(sync.send('settings', { dailyNew: 5 }))
    assert.ok(sync.pending)
    sync.accept({ state: { ...initialState(), revision: 4 }, serverNow: new Date().toISOString() })
    sync.accept({ state: { ...initialState(), revision: 2 }, serverNow: new Date().toISOString() })
    assert.equal(sync.state.revision, 4)
  } finally {
    globalThis.fetch = original
  }
})

test('uncertain writes keep their operation ID and resolve before another write', async () => {
  const original = globalThis.fetch
  const requests: any[] = []
  const saved = { ...initialState(), revision: 1 }
  let fail = true
  globalThis.fetch = async (url: any, options: any) => {
    requests.push({ url, options })
    if (fail) throw new TypeError('Network unavailable')
    return new Response(
      JSON.stringify({ state: saved, status: 'committed', serverNow: new Date().toISOString() }),
    )
  }
  try {
    const sync = new ArchiveSync('user-a')
    await assert.rejects(sync.send('settings', { dailyNew: 5 }))
    const operationId = sync.pending!.operationId
    assert.equal(sync.state.revision, 0)
    await assert.rejects(sync.send('undo', {}))
    assert.equal(sync.pending!.operationId, operationId)
    fail = false
    await sync.recover()
    assert.equal(sync.pending, null)
    assert.equal(sync.state.revision, 1)
    assert.match(requests[1].url, new RegExp(operationId))
    assert.equal(requests[0].options.headers['X-Word-User'], 'user-a')
  } finally {
    globalThis.fetch = original
  }
})
