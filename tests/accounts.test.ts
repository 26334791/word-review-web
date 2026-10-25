import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { nextTask } from '../src/review.ts'
import { request as httpRequest } from 'node:http'
import { Store, createApp } from '../server/app.ts'

test('accounts isolate progress, deduplicate commands, reject conflicts and revoke sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'words-accounts-'))
  const store = new Store(dir)
  assert.throws(() => createApp(store, resolve('dist')), /init-admin/)
  await store.createUser('admin', 'test-password-123', true, false)
  const server = createApp(store, resolve('dist'))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  let cookie = ''
  async function request(path: string, body?: unknown, session = cookie, origin = base) {
    const response = await fetch(base + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: session, Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie'),
      cache: response.headers.get('cache-control'),
    }
  }
  try {
    assert.equal((await request('state')).status, 401)
    const login = await request('login', { username: 'admin', password: 'test-password-123' })
    assert.equal(login.status, 200)
    assert.match(login.cookie!, /HttpOnly; SameSite=Strict/)
    cookie = login.cookie!.split(';')[0]
    const admin = cookie
    const alice = await request('admin/users', {
      username: 'alice',
      password: 'alice-password-123',
    })
    assert.equal(alice.status, 200)
    const userId = alice.data.user.id
    const aliceLogin = await request('login', { username: 'alice', password: 'alice-password-123' })
    cookie = aliceLogin.cookie!.split(';')[0]
    assert.equal((await request('state')).status, 403)
    assert.equal(
      (
        await request('password', {
          currentPassword: 'alice-password-123',
          password: 'alice-new-password',
        })
      ).status,
      200,
    )
    assert.equal((await request('state')).status, 401)
    cookie = (
      await request('login', { username: 'alice', password: 'alice-new-password' })
    ).cookie!.split(';')[0]
    const payload = {
      operationId: 'one',
      expectedRevision: 0,
      type: 'settings',
      payload: { dailyNew: 7 },
    }
    const saved = await request('commands', payload)
    assert.equal(saved.status, 200)
    assert.equal(saved.data.state.revision, 1)
    assert.equal((await request('commands', payload)).data.state.revision, 1)
    assert.equal((await request('operations/one')).data.status, 'committed')
    assert.equal((await request('commands', { ...payload, operationId: 'two' })).status, 409)
    assert.equal((await request('state', undefined, admin)).data.state.settings.dailyNew, 10)
    assert.equal(
      (
        await request(
          'commands',
          { ...payload, operationId: 'bad', expectedRevision: 1 },
          cookie,
          'http://evil.test',
        )
      ).status,
      403,
    )
    assert.equal((await request('admin/users')).status, 403)
    assert.equal(
      (await request('state?userId=' + login.data.user.id)).data.state.settings.dailyNew,
      7,
    )
    assert.equal(
      (
        await request('commands', {
          operationId: 'invalid',
          expectedRevision: 1,
          type: 'restore',
          payload: '{}',
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await request('commands', {
          operationId: 'migration',
          expectedRevision: 1,
          type: 'migrate',
          payload: JSON.stringify(saved.data.state),
        })
      ).status,
      409,
    )
    const book = {
      id: 'test-book',
      title: '测试词表',
      publisher: '自备',
      grade: 4,
      semester: '上册',
      startGrade: 3,
      edition: '自备',
      source: '',
      paused: false,
    }
    const rows = [
      {
        en: 'apple',
        zh: '苹果',
        pos: 'n.',
        phonetic: '',
        unit: 'Unit 1',
        audio: '',
        example: '',
        sourceId: 'apple',
        sourceRow: 2,
      },
    ]
    const imported = await request('commands', {
      operationId: 'import',
      expectedRevision: 1,
      type: 'import',
      payload: { book, rows },
    })
    assert.equal(imported.status, 200)
    const task = nextTask(imported.data.state, new Date())
    const grade = {
      operationId: 'grade',
      expectedRevision: 2,
      type: 'rate',
      payload: { task, grade: 3, audioPlayed: false, now: '2099-01-01' },
    }
    const before = Date.now()
    const race = await Promise.all([
      request('commands', grade),
      request('commands', { ...grade, operationId: 'racing-grade' }),
    ])
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409])
    const graded = race.find((r) => r.status === 200)!.data.state
    assert.equal(graded.logs.length, 1)
    assert.ok(
      Date.parse(graded.logs[0].at) >= before && Date.parse(graded.logs[0].at) <= Date.now(),
    )
    const winningId = race[0].status === 200 ? 'grade' : 'racing-grade'
    assert.equal(
      (await request('commands', { ...grade, operationId: winningId })).data.state.logs.length,
      1,
    )
    assert.equal(
      (
        await request('commands', {
          ...grade,
          operationId: winningId,
          payload: { ...grade.payload, grade: 4 },
        })
      ).status,
      409,
    )
    assert.equal(
      (await request('operations/' + winningId, undefined, admin)).data.status,
      'unknown',
    )
    assert.equal(
      (
        await request('commands', {
          operationId: 'pause',
          expectedRevision: 3,
          type: 'pause',
          payload: { bookId: book.id, paused: true },
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await request('commands', {
          operationId: 'undo',
          expectedRevision: 4,
          type: 'undo',
          payload: {},
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await request('commands', {
          operationId: 'restore',
          expectedRevision: 5,
          type: 'restore',
          payload: JSON.stringify(graded),
        })
      ).status,
      200,
    )
    store.db.prepare('UPDATE sessions SET expires=0 WHERE userId=?').run(userId)
    assert.equal((await request('state')).status, 401)
    cookie = (
      await request('login', { username: 'alice', password: 'alice-new-password' })
    ).cookie!.split(';')[0]
    const switched = await fetch(base + '/api/commands', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: base,
        'Content-Type': 'application/json',
        'X-Word-User': login.data.user.id,
      },
      body: JSON.stringify({ ...payload, expectedRevision: 6 }),
    })
    assert.equal(switched.status, 401)
    assert.equal(
      (await request('admin/users/' + login.data.user.id, { enabled: false }, admin)).status,
      400,
    )
    assert.equal(
      (await request('admin/users/' + userId, { password: 'reset-password-123' }, admin)).status,
      200,
    )
    assert.equal((await request('state')).status, 401)
    cookie = (
      await request('login', { username: 'alice', password: 'reset-password-123' })
    ).cookie!.split(';')[0]
    assert.equal((await request('admin/users/' + userId, { enabled: false }, admin)).status, 200)
    assert.equal((await request('me')).status, 401)
    assert.equal((await request('state', undefined, admin)).cache, 'no-store')
    assert.equal((await request('logout', {}, admin)).status, 200)
    assert.equal((await request('me', undefined, admin)).status, 401)
    cookie = (
      await request('login', { username: 'admin', password: 'test-password-123' })
    ).cookie!.split(';')[0]
    const started = once(server, 'request')
    const incoming = httpRequest(base + '/api/admin/users', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    })
    const completed = new Promise<number>((resolve) =>
      incoming.on('response', (response) => {
        response.resume()
        resolve(response.statusCode!)
      }),
    )
    incoming.write('{"username":"late-account",')
    await started
    store.db.prepare('DELETE FROM sessions WHERE userId=?').run(login.data.user.id)
    incoming.end('"password":"late-test-password"}')
    assert.equal(await completed, 401)
    cookie = (
      await request('login', { username: 'admin', password: 'test-password-123' })
    ).cookie!.split(';')[0]
    for (const malformed of [
      null,
      { type: 'rate', payload: {} },
      { type: 'restore', payload: null },
      { type: 'import', payload: { book: null, rows: [null] } },
    ]) {
      assert.equal(
        (
          await request(
            'commands',
            malformed === null
              ? null
              : { operationId: 'malformed-' + malformed.type, expectedRevision: 0, ...malformed },
          )
        ).status,
        400,
      )
    }
    for (let i = 0; i < 10; i++)
      assert.equal((await request('login', { username: 'missing', password: 'wrong' })).status, 401)
    assert.equal((await request('login', { username: 'missing', password: 'wrong' })).status, 429)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
    store.close()
    await rm(dir, { recursive: true, force: true })
  }
})
