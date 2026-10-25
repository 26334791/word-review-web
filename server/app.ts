import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync, realpathSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep, extname } from 'node:path'
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { initialState } from '../src/model.ts'
import type { State } from '../src/model.ts'
import { importBook } from '../src/imports.ts'
import { rate, undo, restoreBackup } from '../src/review.ts'

const derive = promisify(scrypt)
const lifetime = 7 * 86400_000
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
class ApiError extends Error {
  status: number
  extra: Record<string, unknown>
  constructor(status: number, message: string, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}
interface User {
  id: string
  username: string
  admin: number
  enabled: number
  mustChange: number
  salt: string
  passwordHash: string
}
const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  admin: !!u.admin,
  enabled: !!u.enabled,
  mustChange: !!u.mustChange,
})
function passwordCheck(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256)
    throw new ApiError(400, '密码须为 10–256 个字符。')
}
async function passwordRecord(password: unknown) {
  passwordCheck(password)
  const salt = randomBytes(16).toString('hex')
  return { salt, passwordHash: ((await derive(password, salt, 64)) as Buffer).toString('hex') }
}
async function verify(password: unknown, user?: User) {
  if (typeof password !== 'string' || password.length > 256) return false
  const result = (await derive(password, user?.salt ?? 'missing-account', 64)) as Buffer
  return !!user && timingSafeEqual(result, Buffer.from(user.passwordHash, 'hex'))
}
export class Store {
  db: DatabaseSync
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, 'word-review.sqlite')
    this.db = new DatabaseSync(file)
    chmodSync(file, 0o600)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,admin INTEGER NOT NULL,enabled INTEGER NOT NULL,mustChange INTEGER NOT NULL,salt TEXT NOT NULL,passwordHash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles(userId TEXT PRIMARY KEY REFERENCES users(id),state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(userId TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(userId,id));`)
  }
  initialized() {
    return !!this.db.prepare('SELECT id FROM users WHERE admin=1 AND enabled=1 LIMIT 1').get()
  }
  async createUser(
    username: unknown,
    password: unknown,
    admin = false,
    mustChange = true,
    authorize?: () => void,
  ) {
    if (typeof username !== 'string' || !/^[\p{L}\p{N}_-]{1,40}$/u.test(username))
      throw new ApiError(400, '账号须为 1–40 个汉字、字母、数字、下划线或短横线。')
    const record = await passwordRecord(password)
    const id = randomUUID()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      authorize?.()
      if (this.db.prepare('SELECT id FROM users WHERE username=?').get(username))
        throw new ApiError(400, '账号已存在。')
      this.db
        .prepare('INSERT INTO users VALUES(?,?,?,1,?,?,?)')
        .run(id, username, Number(admin), Number(mustChange), record.salt, record.passwordHash)
      this.db.prepare('INSERT INTO profiles VALUES(?,?)').run(id, JSON.stringify(initialState()))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return publicUser(this.user(id)!)
  }
  user(id: string) {
    return this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as unknown as User | undefined
  }
  state(id: string): State {
    return JSON.parse(
      (this.db.prepare('SELECT state FROM profiles WHERE userId=?').get(id) as { state: string })
        .state,
    )
  }
  command(userId: string, command: any) {
    if (
      !command ||
      typeof command.operationId !== 'string' ||
      !/^[\w-]{1,100}$/.test(command.operationId) ||
      !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 0
    )
      throw new ApiError(400, '操作编号或档案版本无效。')
    const digest = hash(JSON.stringify(command))
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.state(userId)
      const previous = this.db
        .prepare('SELECT * FROM operations WHERE userId=? AND id=?')
        .get(userId, command.operationId) as { digest: string; revision: number } | undefined
      if (previous) {
        if (previous.digest !== digest)
          throw new ApiError(409, '此操作编号已用于另一请求。', { state: current })
        this.db.exec('COMMIT')
        return {
          state: current,
          operationRevision: previous.revision,
          serverNow: new Date().toISOString(),
        }
      }
      if (current.revision !== command.expectedRevision)
        throw new ApiError(409, '另一台设备已更新档案，请刷新当前练习。', { state: current })
      const now = new Date(),
        p = command.payload
      let next: State
      switch (command.type) {
        case 'settings': {
          if (
            !p ||
            typeof p !== 'object' ||
            Array.isArray(p) ||
            Object.keys(p).some((k) => !Object.hasOwn(current.settings, k))
          )
            throw new ApiError(400, '学习设置无效。')
          next = restoreBackup(
            JSON.stringify({ ...current, settings: { ...current.settings, ...p } }),
          )
          break
        }
        case 'import': {
          if (!p || !Array.isArray(p.rows) || !p.rows.length || p.rows.length > 20000)
            throw new ApiError(400, '词表须包含 1–20000 行。')
          next = restoreBackup(JSON.stringify(importBook(current, p.book, p.rows)))
          break
        }
        case 'rate':
          next = rate(current, p?.task, p?.grade, now, p?.audioPlayed === true)
          break
        case 'undo':
          next = undo(current, now)
          break
        case 'pause': {
          next = structuredClone(current)
          const book = next.books.find((b) => b.id === p?.bookId)
          if (!book || typeof p.paused !== 'boolean')
            throw new ApiError(400, '教材或暂停状态无效。')
          book.paused = p.paused
          break
        }
        case 'migrate':
          if (
            current.books.length ||
            current.words.length ||
            current.logs.length ||
            Object.keys(current.cards).length ||
            current.revision !== 0
          )
            throw new ApiError(409, '仅空账号可以迁入旧档案。', { state: current })
          next = restoreBackup(p)
          break
        case 'restore':
          next = restoreBackup(p)
          break
        default:
          throw new ApiError(400, '未知写入指令。')
      }
      next.revision = current.revision + 1
      // ponytail: one JSON archive per user; split histories into rows if measured write latency grows.
      this.db
        .prepare('UPDATE profiles SET state=? WHERE userId=?')
        .run(JSON.stringify(next), userId)
      this.db
        .prepare('INSERT INTO operations VALUES(?,?,?,?)')
        .run(userId, command.operationId, digest, next.revision)
      this.db.exec('COMMIT')
      return { state: next, operationRevision: next.revision, serverNow: now.toISOString() }
    } catch (error) {
      this.db.exec('ROLLBACK')
      if (!(error instanceof ApiError) && !(error as { code?: string }).code)
        throw new ApiError(
          400,
          error instanceof TypeError ? '指令参数格式无效。' : (error as Error).message,
        )
      throw error
    }
  }
  close() {
    this.db.close()
  }
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 55 * 1024 * 1024) throw new ApiError(413, '请求超过 55 MB。')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ApiError(400, '请求须为有效 JSON。')
  }
}
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
export function createApp(store: Store, root: string) {
  if (!store.initialized())
    throw new Error('请先在本机运行 --init-admin，创建管理员后再启动局域网服务。')
  root = realpathSync.native(root)
  const failures = new Map<string, { count: number; until: number }>()
  const send = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(JSON.stringify(data))
  }
  return createServer(async (req, res) => {
    let path = ''
    try {
      try {
        path = new URL(req.url!, 'http://localhost').pathname
      } catch {
        throw new ApiError(400, '请求地址无效。')
      }
      if (path.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store')
        if (!['GET', 'POST'].includes(req.method!)) throw new ApiError(405, '不支持此请求方式。')
        if (
          req.method === 'POST' &&
          (req.headers.origin !== `http://${req.headers.host}` ||
            !req.headers['content-type']?.startsWith('application/json'))
        )
          throw new ApiError(403, '请求来源无效，请通过本服务页面操作。')
        const p = req.method === 'POST' ? await body(req) : null
        const token = req.headers.cookie
          ?.split(';')
          .map((v) => v.trim())
          .find((v) => v.startsWith('word_session='))
          ?.slice(13)
        const session = token
          ? (store.db
              .prepare('SELECT userId,expires FROM sessions WHERE token=?')
              .get(hash(token)) as { userId: string; expires: number } | undefined)
          : undefined
        const user =
          session && session.expires > Date.now() ? store.user(session.userId) : undefined
        if (path === '/api/login' && req.method === 'POST') {
          const ip = req.socket.remoteAddress ?? ''
          for (const [key, value] of failures) if (value.until < Date.now()) failures.delete(key)
          const attempt = failures.get(ip)
          if (attempt && attempt.count >= 10)
            throw new ApiError(429, '尝试过多，请十五分钟后再试。')
          if (failures.size >= 10000 && !attempt) throw new ApiError(429, '登录繁忙，请稍后再试。')
          failures.set(ip, {
            count: (attempt?.count ?? 0) + 1,
            until: attempt?.until ?? Date.now() + 900000,
          })
          const account =
            typeof p?.username === 'string'
              ? (store.db
                  .prepare('SELECT * FROM users WHERE username=?')
                  .get(p.username) as unknown as User | undefined)
              : undefined
          if (!(await verify(p?.password, account)) || !account?.enabled)
            throw new ApiError(401, '账号或密码错误，或账号已停用。')
          // Re-read after asynchronous password hashing: a concurrent reset/disable must win.
          const latest = store.user(account.id)!
          if (!latest.enabled || latest.passwordHash !== account.passwordHash)
            throw new ApiError(401, '账号状态已更新，请重新登录。')
          failures.delete(ip)
          store.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now())
          const secret = randomBytes(32).toString('hex')
          store.db
            .prepare('INSERT INTO sessions VALUES(?,?,?)')
            .run(hash(secret), latest.id, Date.now() + lifetime)
          res.setHeader(
            'Set-Cookie',
            `word_session=${secret}; Path=/; Max-Age=604800; HttpOnly; SameSite=Strict`,
          )
          send(res, 200, { user: publicUser(latest) })
          return
        }
        if (!user?.enabled) throw new ApiError(401, '请登录后继续。')
        if (req.headers['x-word-user'] && req.headers['x-word-user'] !== user.id)
          throw new ApiError(401, '此浏览器已切换账号，请重新登录当前页面。')
        const ensureSession = () => {
          const active = store.db
            .prepare('SELECT expires FROM sessions WHERE token=? AND userId=?')
            .get(hash(token!), user.id)
          const latest = store.user(user.id)!
          if (
            !active ||
            Number(active.expires) <= Date.now() ||
            !latest.enabled ||
            latest.passwordHash !== user.passwordHash
          )
            throw new ApiError(401, '账号或会话已更新，请重新登录。')
        }
        if (path === '/api/me' && req.method === 'GET') {
          send(res, 200, { user: publicUser(user) })
          return
        }
        if (path === '/api/logout' && req.method === 'POST') {
          store.db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token!))
          res.setHeader('Set-Cookie', 'word_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict')
          send(res, 200, { ok: true })
          return
        }
        if (path === '/api/password' && req.method === 'POST') {
          if (!(await verify(p?.currentPassword, user))) throw new ApiError(400, '当前密码错误。')
          if (p.password === p.currentPassword) throw new ApiError(400, '新密码须与当前密码不同。')
          const record = await passwordRecord(p.password)
          ensureSession()
          const latest = store.user(user.id)!
          if (!latest.enabled || latest.passwordHash !== user.passwordHash)
            throw new ApiError(401, '账号状态已更新，请重新登录。')
          store.db.exec('BEGIN IMMEDIATE')
          try {
            store.db
              .prepare('UPDATE users SET salt=?,passwordHash=?,mustChange=0 WHERE id=?')
              .run(record.salt, record.passwordHash, user.id)
            store.db.prepare('DELETE FROM sessions WHERE userId=?').run(user.id)
            store.db.exec('COMMIT')
          } catch (e) {
            store.db.exec('ROLLBACK')
            throw e
          }
          send(res, 200, { ok: true })
          return
        }
        if (user.mustChange) throw new ApiError(403, '首次登录请先修改密码。', { mustChange: true })
        if (path === '/api/state' && req.method === 'GET') {
          send(res, 200, { state: store.state(user.id), serverNow: new Date().toISOString() })
          return
        }
        if (path === '/api/commands' && req.method === 'POST') {
          send(res, 200, store.command(user.id, p))
          return
        }
        if (path.startsWith('/api/operations/') && req.method === 'GET') {
          const op = store.db
            .prepare('SELECT revision FROM operations WHERE userId=? AND id=?')
            .get(user.id, decodeURIComponent(path.slice(16)))
          send(res, 200, {
            status: op ? 'committed' : 'unknown',
            operationRevision: op?.revision,
            state: store.state(user.id),
            serverNow: new Date().toISOString(),
          })
          return
        }
        if (path.startsWith('/api/catalog/') && req.method === 'GET') {
          const catalog = JSON.parse(await readFile(join(root, 'data/catalog.json'), 'utf8'))
          const entry = catalog.find((v: any) => v.id === path.slice(13))
          if (!entry || !/^\/data\/[\w-]+\.csv$/.test(entry.file))
            throw new ApiError(404, '找不到教材。')
          const csv = await readFile(join(root, entry.file))
          if (createHash('sha256').update(csv).digest('hex') !== entry.sha256)
            throw new ApiError(503, '词表校验失败，请检查服务端教材文件。')
          send(res, 200, { csv: csv.toString('utf8') })
          return
        }
        if (path.startsWith('/api/admin/users')) {
          if (!user.admin) throw new ApiError(403, '仅管理员可以管理账号。')
          if (path === '/api/admin/users') {
            if (req.method === 'GET')
              send(res, 200, {
                users: (
                  store.db
                    .prepare('SELECT * FROM users ORDER BY username')
                    .all() as unknown as User[]
                ).map(publicUser),
              })
            else
              send(res, 200, {
                user: await store.createUser(
                  p?.username,
                  p?.password,
                  p?.admin === true,
                  true,
                  ensureSession,
                ),
              })
            return
          }
          if (req.method !== 'POST') throw new ApiError(405, '不支持此请求方式。')
          const target = store.user(path.slice(17))
          if (!target) throw new ApiError(404, '账号不存在。')
          const record = p?.password !== undefined ? await passwordRecord(p.password) : null
          ensureSession()
          if (!record && typeof p?.enabled !== 'boolean')
            throw new ApiError(400, '请指定账号状态或新密码。')
          store.db.exec('BEGIN IMMEDIATE')
          try {
            if (
              p.enabled === false &&
              target.admin &&
              (store.db
                .prepare('SELECT count(*) AS n FROM users WHERE admin=1 AND enabled=1')
                .get()!.n as number) <= 1 &&
              target.enabled
            )
              throw new ApiError(400, '不能停用最后一个管理员。')
            if (typeof p.enabled === 'boolean')
              store.db
                .prepare('UPDATE users SET enabled=? WHERE id=?')
                .run(Number(p.enabled), target.id)
            if (record)
              store.db
                .prepare('UPDATE users SET salt=?,passwordHash=?,mustChange=1 WHERE id=?')
                .run(record.salt, record.passwordHash, target.id)
            store.db.prepare('DELETE FROM sessions WHERE userId=?').run(target.id)
            store.db.exec('COMMIT')
          } catch (e) {
            store.db.exec('ROLLBACK')
            throw e
          }
          send(res, 200, { ok: true })
          return
        }
        throw new ApiError(404, '接口不存在。')
      }
      if (!['GET', 'HEAD'].includes(req.method!)) {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        res.end()
        return
      }
      let decoded: string
      try {
        decoded = decodeURIComponent(path)
      } catch {
        throw new ApiError(400, '地址无效。')
      }
      if (decoded.includes('\0')) throw new ApiError(400, '地址无效。')
      const inside = (file: string) => {
        const r = relative(root, file)
        return r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r)
      }
      const candidate = resolve(
        root,
        '.' + (decoded.endsWith('/') ? decoded + 'index.html' : decoded),
      )
      if (!inside(candidate)) throw new ApiError(403, '地址无效。')
      const file = await realpath(candidate)
      if (!inside(file)) throw new ApiError(403, '地址无效。')
      const data = await readFile(file)
      res.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch (error) {
      const e = error as ApiError & { code?: string }
      const status =
        e.status ?? (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(e.code ?? '') ? 404 : 500)
      if (status === 500) console.error('请求处理失败', e.message)
      send(res, status, {
        error: status === 500 ? '服务端处理失败，请重试。' : e.message,
        ...e.extra,
      })
    }
  })
}
