import test from 'node:test'
import assert from 'node:assert/strict'
import { findBrowserExecutable } from './browser-tools.mjs'

test('explicit browser executable does not require an installation cache', () => {
  const chromium = {
    executablePath() {
      throw new Error('Default browser discovery must not run')
    },
  }
  assert.equal(
    findBrowserExecutable(chromium, {
      PLAYWRIGHT_EXECUTABLE: '/custom/chromium',
      LOCALAPPDATA: '/missing/cache',
    }),
    '/custom/chromium',
  )
  assert.equal(
    findBrowserExecutable({ executablePath: () => process.execPath }, {}),
    process.execPath,
  )
})
