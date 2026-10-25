import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('runtime data stays ignored while new public textbook assets can be staged normally', () => {
  const ignored = (path) => {
    const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
      input: path + '\n',
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.ok(result.status === 0 || result.status === 1, result.stderr || String(result.error))
    return result.status === 0
  }
  assert.equal(ignored('data/profile-backup.json'), true)
  assert.equal(ignored('data/word-review.sqlite'), true)
  assert.equal(ignored('public/data/new-textbook-probe.csv'), false)
  assert.equal(ignored('public/data/new-textbook-probe.json'), false)
  assert.equal(ignored('public/data/new-textbook-probe.xlsx'), false)
  assert.equal(ignored('public/data/new-textbook-source.docx'), true)
})
