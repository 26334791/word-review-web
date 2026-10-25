import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'

const url = 'http://127.0.0.1:5173/'
export async function isAppRunning(): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
    const html = await response.text()
    return (
      response.ok &&
      html.includes('<title>单词日课</title>') &&
      html.includes('/manifest.webmanifest')
    )
  } catch {
    return false
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) process.exit((await isAppRunning()) ? 0 : 1)
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isAppRunning()) {
      ready = true
      break
    }
    await setTimeout(500)
  }
  if (!ready) {
    console.error('服务尚未就绪，未自动打开浏览器。请检查启动窗口。')
    process.exit(1)
  }
  // Fixed localhost URL only; no user-provided shell text.
  const browser = spawn('cmd.exe', ['/d', '/c', 'start', '""', url], {
    windowsHide: true,
    windowsVerbatimArguments: true,
    stdio: 'ignore',
  })
  browser.on('error', (error) => {
    console.error('浏览器未能打开：', error.message)
    process.exitCode = 1
  })
}
