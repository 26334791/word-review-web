import test from 'node:test'
import assert from 'node:assert/strict'
import { uuid } from '../src/id.ts'
test('UUID works with getRandomValues only, without secure-context randomUUID', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: original
        .get!.call(globalThis)
        .getRandomValues.bind(original.get!.call(globalThis)),
    },
  })
  try {
    const ids = Array.from({ length: 100 }, () => uuid())
    assert.equal(new Set(ids).size, 100)
    assert.match(ids[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  } finally {
    Object.defineProperty(globalThis, 'crypto', original)
  }
})
