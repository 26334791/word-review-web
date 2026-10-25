import { initialState } from './model.ts'
import type { State } from './model.ts'
import { uuid } from './id.ts'

export interface Account {
  id: string
  username: string
  admin: boolean
  enabled: boolean
  mustChange: boolean
}
export class ApiFailure extends Error {
  status: number
  state?: State
  constructor(status: number, data: any) {
    super(data.error ?? '请求失败。')
    this.status = status
    this.state = data.state
  }
}
export async function api(path: string, body?: unknown, userId?: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch('/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(userId ? { 'X-Word-User': userId } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok) throw new ApiFailure(response.status, result)
    return result
  } finally {
    clearTimeout(timer)
  }
}
interface Command {
  operationId: string
  expectedRevision: number
  type: string
  payload: unknown
}
export class ArchiveSync {
  userId: string
  state = initialState()
  pending: Command | null = null
  offset = 0
  constructor(userId: string) {
    this.userId = userId
    try {
      this.pending = JSON.parse(sessionStorage.getItem('word-pending-' + userId) ?? 'null')
    } catch {
      /* No browser storage, or corrupt scratch data. */
    }
  }
  now() {
    return new Date(Date.now() + this.offset)
  }
  accept(result: { state: State; serverNow: string }) {
    if (result.state.revision >= this.state.revision) this.state = result.state
    this.offset = Date.parse(result.serverNow) - Date.now()
  }
  remember() {
    try {
      if (this.pending)
        sessionStorage.setItem('word-pending-' + this.userId, JSON.stringify(this.pending))
      else sessionStorage.removeItem('word-pending-' + this.userId)
    } catch {
      /* The in-memory pending operation still protects this page. */
    }
  }
  async refresh() {
    this.accept(await api('state', undefined, this.userId))
  }
  async send(type: string, payload: unknown) {
    if (this.pending) throw new Error('上次保存结果尚未确认，请先重新连接。')
    this.pending = { operationId: uuid(), expectedRevision: this.state.revision, type, payload }
    this.remember()
    return this.submit()
  }
  private async submit() {
    try {
      const result = await api('commands', this.pending, this.userId)
      this.accept(result)
      this.pending = null
      this.remember()
      return result
    } catch (error) {
      if (error instanceof ApiFailure && error.status < 500) {
        if (error.state) this.state = error.state
        this.pending = null
        this.remember()
      }
      throw error
    }
  }
  async recover() {
    if (!this.pending) {
      await this.refresh()
      return
    }
    const result = await api('operations/' + this.pending.operationId, undefined, this.userId)
    if (result.status === 'committed') {
      this.accept(result)
      this.pending = null
      this.remember()
    } else await this.submit()
  }
}
