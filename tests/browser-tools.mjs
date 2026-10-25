import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function findBrowserExecutable(chromium, env = process.env) {
  if (env.PLAYWRIGHT_EXECUTABLE) return env.PLAYWRIGHT_EXECUTABLE
  const preferred = chromium.executablePath()
  if (existsSync(preferred)) return preferred
  if (!env.LOCALAPPDATA) return undefined
  const browserRoot = join(env.LOCALAPPDATA, 'ms-playwright')
  if (!existsSync(browserRoot)) return undefined
  return readdirSync(browserRoot)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .flatMap((name) =>
      ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'].map((path) =>
        join(browserRoot, name, path),
      ),
    )
    .find(existsSync)
}

export function browserTools(env = process.env) {
  const require = createRequire(
    env.PLAYWRIGHT_MODULE_DIR
      ? resolve(env.PLAYWRIGHT_MODULE_DIR, 'package.json')
      : import.meta.url,
  )
  let chromium
  try {
    chromium = require('playwright').chromium
  } catch (error) {
    if (env.PLAYWRIGHT_MODULE_DIR || error.code !== 'MODULE_NOT_FOUND') throw error
    const bundled = join(
      env.USERPROFILE || env.HOME || homedir(),
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
    )
    if (!existsSync(join(bundled, 'playwright/package.json')))
      throw new Error(
        'Install Playwright locally, or set PLAYWRIGHT_MODULE_DIR to an existing node_modules directory.',
      )
    chromium = createRequire(join(bundled, 'package.json'))('playwright').chromium
  }
  return { chromium, executablePath: findBrowserExecutable(chromium, env) }
}
