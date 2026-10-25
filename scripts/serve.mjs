import { Store, createApp } from '../server-dist/app.mjs'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { networkInterfaces } from 'node:os'

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('需要 Node.js 24 或更新版本。')
  const { values } = parseArgs({
    options: {
      'no-browser': { type: 'boolean' },
      'init-admin': { type: 'boolean' },
      port: { type: 'string', default: '5173' },
      host: { type: 'string', default: '0.0.0.0' },
      'data-dir': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(
      'node scripts/serve.mjs [--init-admin] [--no-browser] [--port 5173] [--host 0.0.0.0] [--data-dir 路径]',
    )
    return
  }
  const port = Number(values.port)
  if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('端口须为 0–65535 的整数。')
  const store = new Store(
    values['data-dir']
      ? resolve(values['data-dir'])
      : fileURLToPath(new URL('../data/', import.meta.url)),
  )
  if (values['init-admin']) {
    try {
      if (store.initialized()) throw new Error('管理员已初始化，请登录后在账号管理页操作。')
      if (!process.stdin.isTTY) throw new Error('--init-admin 须在本机交互式终端运行。')
      let hidden = false
      const output = new Writable({
        write(chunk, _encoding, done) {
          if (!hidden) process.stdout.write(chunk)
          done()
        },
      })
      const input = createInterface({ input: process.stdin, output, terminal: true })
      try {
        const username = await input.question('管理员账号：')
        process.stdout.write('管理员密码（至少 10 个字符，不回显）：')
        hidden = true
        const password = await input.question('')
        hidden = false
        process.stdout.write('\n再次输入密码：')
        hidden = true
        const confirmation = await input.question('')
        hidden = false
        process.stdout.write('\n')
        if (password !== confirmation) throw new Error('两次密码不一致。')
        await store.createUser(username.trim(), password, true, false)
        console.log('管理员已创建。请再次运行启动命令，开放局域网服务。')
      } finally {
        input.close()
      }
    } finally {
      store.close()
    }
    return
  }
  let server
  try {
    server = createApp(store, await realpath(fileURLToPath(new URL('../dist/', import.meta.url))))
  } catch (error) {
    store.close()
    throw error
  }
  await new Promise((ready, reject) => {
    server.once('error', reject)
    server.listen(port, values.host, ready)
  })
  const local = values.host === '0.0.0.0' ? '127.0.0.1' : values.host
  const address = local.includes(':') ? '[' + local + ']' : local
  const url = `http://${address}:${server.address().port}/`
  console.log(`单词日课已启动：${url}\n保持此窗口运行，按 Ctrl+C 停止。`)
  if (values.host === '0.0.0.0')
    for (const entries of Object.values(networkInterfaces()))
      for (const entry of entries ?? [])
        if (entry.family === 'IPv4' && !entry.internal)
          console.log(`局域网地址：http://${entry.address}:${server.address().port}/`)
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () =>
      server.close(() => {
        store.close()
        process.exit()
      }),
    )
  if (!values['no-browser']) {
    const command =
      process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const browser = spawn(
      command,
      process.platform === 'win32' ? ['/d', '/c', 'start', '""', url] : [url],
      {
        windowsHide: true,
        windowsVerbatimArguments: process.platform === 'win32',
        stdio: 'ignore',
      },
    )
    browser.on('error', () => console.error(`浏览器未能自动打开，请访问 ${url}`))
    browser.on('exit', (code) => {
      if (code) console.error(`浏览器未能自动打开，请访问 ${url}`)
    })
  }
}
main().catch((error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? '端口已被占用，请打开已有页面，或使用 --port 5174。'
      : error.message,
  )
  process.exitCode = 1
})
