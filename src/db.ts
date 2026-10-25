import { initialState } from './model.ts'
import type { State } from './model.ts'

let connection: Promise<IDBDatabase> | undefined
function database(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('word-review-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('archive')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      connection = undefined
      reject(new Error('无法打开本机学习档案，请检查浏览器是否允许保存网站数据。'))
    }
    request.onblocked = () => reject(new Error('数据库升级被其他页面阻塞，请关闭旧页面后重试。'))
  })
  return connection
}
export async function loadState(): Promise<State> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('archive').objectStore('archive').get('main')
    request.onsuccess = () => resolve(request.result ?? initialState())
    request.onerror = () => reject(new Error('读取学习档案失败，请重试。'))
  })
}
export async function updateState(
  expectedRevision: number,
  change: (state: State) => State,
): Promise<State> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('archive', 'readwrite')
    const store = tx.objectStore('archive')
    const request = store.get('main')
    let next: State, reason: unknown
    request.onsuccess = () => {
      try {
        const current: State = request.result ?? initialState()
        if (current.revision !== expectedRevision)
          throw new Error('另一个页面已更新档案。请刷新页面后重试，当前内容尚未保存。')
        // ponytail: whole archive per transaction; split stores if large review histories make writes slow.
        next = change(current)
        next.revision = current.revision + 1
        store.put(next, 'main')
      } catch (error) {
        reason = error
        tx.abort()
      }
    }
    tx.oncomplete = () => resolve(next)
    tx.onerror = () => {
      reason ??= new Error('保存失败，可能是本机空间不足。当前评分未提交，请重试。')
    }
    tx.onabort = () => reject(reason ?? new Error('保存被中止，原档案保持不变。'))
  })
}
