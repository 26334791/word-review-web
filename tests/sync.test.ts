import test from 'node:test'
import assert from 'node:assert/strict'
import { ArchiveSync } from '../src/sync.ts'
import { initialState } from '../src/model.ts'

test('a delayed conflict cannot replace a newer snapshot or roll back the next command revision', async () => {
  const original = globalThis.fetch
  let finish!: (response: Response) => void
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      finish = resolve
    })
  try {
    const sync = new ArchiveSync('delayed-conflict')
    const saving = sync.send('settings', { dailyNew: 3 })
    const latest = { ...initialState(), revision: 5 }
    latest.settings.dailyNew = 8
    sync.accept({ state: latest, serverNow: new Date().toISOString() })
    const offset = sync.offset
    finish(
      new Response(
        JSON.stringify({ error: 'version conflict', state: { ...initialState(), revision: 3 } }),
        { status: 409 },
      ),
    )
    await assert.rejects(saving, /version conflict/)
    assert.deepEqual(sync.state, latest)
    assert.equal(sync.offset, offset)
    assert.equal(sync.pending, null)
    let expectedRevision: number | undefined
    globalThis.fetch = async (_url, options) => {
      expectedRevision = JSON.parse(options!.body as string).expectedRevision
      return new Response(
        JSON.stringify({ state: { ...latest, revision: 6 }, serverNow: new Date().toISOString() }),
      )
    }
    await sync.send('settings', { dailyNew: 9 })
    assert.equal(expectedRevision, 5)
  } finally {
    globalThis.fetch = original
  }
})

test('a newer conflict snapshot still refreshes state without changing the server clock offset', async () => {
  const original = globalThis.fetch
  const latest = { ...initialState(), revision: 4 }
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'version conflict', state: latest }), { status: 409 })
  try {
    const sync = new ArchiveSync('newer-conflict')
    sync.offset = 5000
    await assert.rejects(sync.send('undo', {}), /version conflict/)
    assert.deepEqual(sync.state, latest)
    assert.equal(sync.pending, null)
    assert.equal(sync.offset, 5000)
  } finally {
    globalThis.fetch = original
  }
})

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
