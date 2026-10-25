import assert from 'node:assert/strict'
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { Store } from '../server-dist/app.mjs'

const scratch = await mkdtemp(join(tmpdir(), 'word-bundle-'))
const targetName = process.platform === 'win32' ? 'windows-x64' : 'linux-x64'
const root = process.env.PORTABLE_DIR
  ? resolve(process.env.PORTABLE_DIR)
  : join(scratch, 'word-review-web')
const data = join(scratch, 'data')
let child
try {
  if (!process.env.PORTABLE_DIR) {
    await mkdir(join(root, 'scripts'), { recursive: true })
    for (const name of ['dist', 'server-dist'])
      await cp(name, join(root, name), { recursive: true })
    await cp('scripts/serve.mjs', join(root, 'scripts/serve.mjs'))
    const config = JSON.parse(await readFile('scripts/node-runtime.json', 'utf8'))
    const target = config.targets.find((v) => v.platform === targetName)
    const cache = join('releases', '.runtime-cache', target.archive)
    let archive
    try {
      archive = await readFile(cache)
    } catch {
      const response = await fetch(config.baseUrl + target.archive)
      assert.ok(response.ok)
      archive = Buffer.from(await response.arrayBuffer())
    }
    assert.equal(createHash('sha256').update(archive).digest('hex'), target.sha256)
    const file = join(scratch, target.archive)
    await writeFile(file, archive)
    await mkdir(join(root, 'runtime'))
    execFileSync(
      'tar',
      [
        '-xf',
        file,
        '-C',
        join(root, 'runtime'),
        '--strip-components',
        '1',
        target.prefix + '/' + target.binary,
      ],
      { windowsHide: true },
    )
    const packaging = await readFile('scripts/package.ps1', 'utf8')
    const launchers = [...packaging.matchAll(/\$launcher = @'\r?\n([\s\S]*?)\r?\n'@/g)]
    assert.equal(launchers.length, 2)
    await writeFile(
      join(root, targetName === 'windows-x64' ? 'start-windows.cmd' : 'start-linux.sh'),
      launchers[targetName === 'windows-x64' ? 0 : 1][1] + '\n',
    )
  }
  const store = new Store(data)
  await store.createUser('admin', 'bundle-check-password', true, false)
  store.close()
  const args = ['--no-browser', '--port', '0', '--data-dir', data, '--host', '127.0.0.1']
  child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', join(root, 'start-windows.cmd'), ...args], {
          cwd: root,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn('sh', [join(root, 'start-linux.sh'), ...args], {
          cwd: root,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
  let output = ''
  const url = await new Promise((yes, no) => {
    const timeout = setTimeout(() => no(Error(output || 'Bundle startup timeout')), 15000)
    child.once('error', no)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      no(Error('Bundle exited ' + code + ': ' + output))
    })
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        output += chunk.toString()
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//)
        if (match) {
          clearTimeout(timeout)
          yes(match[0])
        }
      })
  })
  assert.equal((await fetch(url)).status, 200)
  const login = await fetch(url + 'api/login', {
    method: 'POST',
    headers: { Origin: new URL(url).origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'bundle-check-password' }),
  })
  assert.equal(login.status, 200)
  const state = await fetch(url + 'api/state', {
    headers: { Cookie: login.headers.get('set-cookie').split(';')[0] },
  })
  assert.equal(state.status, 200)
  assert.equal((await state.json()).state.revision, 0)
  console.log('Bundled native launcher + SQLite passed:', targetName)
} finally {
  if (child && child.exitCode === null) {
    const stopped = once(child, 'close')
    if (process.platform === 'win32')
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    else child.kill()
    await stopped
  }
  await rm(scratch, { recursive: true, force: true })
}
