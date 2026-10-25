import { createServer } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'

const types = {
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
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('需要 Node.js 24 或更新版本。')
  const { values } = parseArgs({
    options: {
      'no-browser': { type: 'boolean' },
      port: { type: 'string', default: '5173' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log('node scripts/serve.mjs [--no-browser] [--port 5173]')
    return
  }
  const port = Number(values.port)
  if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('端口须为0–65535的整数（0表示自动分配）。')
  const root = await realpath(fileURLToPath(new URL('../dist/', import.meta.url)))
  await readFile(resolve(root, 'index.html'))
  const inside = (file) => {
    const path = relative(root, file)
    return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)
  }
  const server = createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }
    try {
      let path
      try {
        path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      if (path.includes('\0')) {
        res.writeHead(400)
        res.end()
        return
      }
      const candidate = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path))
      if (!inside(candidate)) {
        res.writeHead(403)
        res.end()
        return
      }
      const file = await realpath(candidate)
      if (!inside(file)) {
        res.writeHead(403)
        res.end()
        return
      }
      const body = await readFile(file)
      res.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch (error) {
      res.writeHead(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500)
      res.end()
    }
  })
  await new Promise((ready, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', ready)
  })
  const url = `http://127.0.0.1:${server.address().port}/`
  console.log(`单词日课已启动：${url}\n保持此窗口运行，按 Ctrl+C 停止。`)
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close(() => process.exit()))
  if (!values['no-browser']) {
    const command =
      process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/d', '/c', 'start', '""', url] : [url]
    const browser = spawn(command, args, {
      windowsHide: true,
      windowsVerbatimArguments: process.platform === 'win32',
      stdio: 'ignore',
    })
    browser.on('error', () => console.error(`浏览器未能自动打开，请手动访问 ${url}`))
    browser.on('exit', (code) => {
      if (code) console.error(`浏览器未能自动打开，请手动访问 ${url}`)
    })
  }
}
main().catch((error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? '端口已被占用。请打开已有页面，或加 --port 5174 启动另一实例。'
      : error.message,
  )
  process.exitCode = 1
})
