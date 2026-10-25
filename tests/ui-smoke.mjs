import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { browserTools } from './browser-tools.mjs'
const { chromium, executablePath } = browserTools()
await mkdir('artifacts', { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const baseURL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173'
try {
  await page.goto(baseURL)
  await page.getByRole('button', { name: '导入北师大四上词表' }).waitFor({ timeout: 5000 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.screenshot({ path: 'artifacts/word-review-empty.png', fullPage: true })
  await page.getByRole('button', { name: '导入北师大四上词表' }).click()
  await page.getByRole('heading', { name: '检查字段与导入预览' }).waitFor()
  assert.match(await page.locator('.preview-stats').innerText(), /有效\s*97/)
  assert.match(await page.locator('.source-note').innerText(), /6个单元与课内释义已逐条对照/)
  await page.screenshot({ path: 'artifacts/word-review-import.png', fullPage: true })
  await page.getByRole('button', { name: '确认导入 97 个有效词条' }).click()
  await page.waitForURL('**/#today')
  assert.match(await page.getByTestId('learned-count').innerText(), /0\s*\/\s*97/)
  assert.match(await page.locator('main').innerText(), /导入完成：新增 97/)
  assert.equal(await page.locator('#active-unit option').count(), 7)
  await page.screenshot({ path: 'artifacts/word-review-home.png', fullPage: true })
  await page.getByRole('button', { name: /开始今日学习/ }).click()
  await page.getByRole('heading', { name: '先听一听，跟着读。' }).waitFor()
  await page.screenshot({ path: 'artifacts/word-review-study.png', fullPage: true })
  await page.getByRole('button', { name: '准备好了，开始回忆' }).click()
  assert.equal(await page.getByTestId('meaning').count(), 0)
  await page.getByRole('button', { name: '查看答案', exact: true }).click()
  await page.locator('[data-action="rate-3"]').click()
  await page.getByRole('heading', { name: '听见声音，想起意思。' }).waitFor()
  assert.equal(await page.locator('.word').count(), 0)
  assert.equal(await page.getByRole('button', { name: '查看答案', exact: true }).isDisabled(), true)
  const voices = await page.evaluate(() =>
    speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang, local: v.localService })),
  )
  console.log('Native voices:', JSON.stringify(voices))
  await page.locator('[data-action="play-task"]').click()
  await page.waitForFunction(
    () => !document.querySelector('[data-action="play-task"]')?.disabled,
    {},
    { timeout: 35000 },
  )
  let nativeSpeechPassed = await page
    .getByRole('button', { name: '查看答案', exact: true })
    .isEnabled()
  if (!nativeSpeechPassed) {
    console.log(
      'Native synthesis unavailable; testing speech-success UI using a speech-only test double.',
    )
    await page.evaluate(() => {
      const fake = new EventTarget()
      fake.getVoices = () => [
        { name: 'UI test voice', lang: 'en-GB', localService: true, voiceURI: 'test-en' },
      ]
      fake.cancel = () => {}
      fake.speak = (utterance) => setTimeout(() => utterance.onend?.(new Event('end')), 30)
      Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true })
    })
    await page.locator('[data-action="play-task"]').click()
  }
  await page.getByRole('button', { name: '查看答案', exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-action="reveal"]').disabled)
  await page.getByRole('button', { name: '查看答案', exact: true }).click()
  await page.locator('[data-action="rate-1"]').click()
  await page.getByRole('heading', { name: '先听一听，跟着读。' }).waitFor()
  const saved = await page.evaluate(async () => (await import('/src/db.ts')).loadState())
  assert.equal(saved.logs.length, 2)
  assert.equal(Object.keys(saved.cards).length, 2)
  const cards = Object.values(saved.cards)
  assert.notEqual(cards[0].schedule.due, cards[1].schedule.due)
  await page.reload()
  await page.getByRole('heading', { name: '先听一听，跟着读。' }).waitFor()
  const restored = await page.evaluate(async () => (await import('/src/db.ts')).loadState())
  assert.deepEqual(restored.logs, saved.logs)
  await page.goto(baseURL + '/#settings')
  await page.getByRole('heading', { name: '备份你的学习记录' }).waitFor()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整备份' }).click()
  const backup = await downloaded
  const { readFile } = await import('node:fs/promises')
  const backupState = JSON.parse(await readFile(await backup.path(), 'utf8'))
  assert.equal(backupState.logs.length, 2)
  await page.locator('#backup-file').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schema":99}'),
  })
  await page.getByRole('status').filter({ hasText: /备份/ }).waitFor()
  const afterInvalid = await page.evaluate(async () => (await import('/src/db.ts')).loadState())
  assert.equal(afterInvalid.logs.length, 2)
  const concurrency = await page.evaluate(async () => {
    const { loadState, updateState } = await import('/src/db.ts')
    const state = await loadState()
    const results = await Promise.allSettled([
      updateState(state.revision, (s) => ({ ...s, settings: { ...s.settings, dailyNew: 9 } })),
      updateState(state.revision, (s) => ({ ...s, settings: { ...s.settings, dailyNew: 8 } })),
    ])
    return results.map((r) => r.status)
  })
  assert.equal(concurrency.filter((status) => status === 'fulfilled').length, 1)
  assert.equal(concurrency.filter((status) => status === 'rejected').length, 1)
  await page.reload()
  await page.goto(baseURL + '/#today')
  await page.getByTestId('learned-count').waitFor()
  assert.match(await page.getByTestId('new-count').innerText(), /^1/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'artifacts/word-review-mobile.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.goto(baseURL + '/#settings')
  await page.locator('#daily-new').fill('1')
  await page.locator('#daily-new').press('Tab')
  await page.waitForFunction(
    async () => (await (await import('/src/db.ts')).loadState()).settings.dailyNew === 1,
  )
  await page.goto(baseURL + '/#today')
  await page.locator('[data-action="start-study"]').click()
  await page.getByRole('heading', { name: '当前没有可练的新任务' }).waitFor({ timeout: 1000 })
  assert.equal(await page.getByRole('button', { name: '撤销上次评分' }).count(), 1)
  await page.getByRole('button', { name: '撤销上次评分' }).click()
  await page.getByRole('heading', { name: '听见声音，想起意思。' }).waitFor()
  const importContext = await browser.newContext()
  const importPage = await importContext.newPage()
  importPage.on('pageerror', (error) => errors.push(error.message))
  await importPage.goto(baseURL + '/#import')
  await importPage.locator('summary').click()
  const pastedDraft = '英文,释义\napple,苹果'
  await importPage.locator('#paste-table').fill(pastedDraft)
  await importPage.locator('#meta-title').fill('自备词表')
  await importPage.locator('#meta-title').press('Tab')
  assert.equal(await importPage.locator('#paste-table').inputValue(), pastedDraft)
  assert.equal(await importPage.locator('#paste-panel').getAttribute('open'), '')
  await importPage
    .locator('#paste-table')
    .fill(
      '英文,释义\n"<img src=x onerror=window.__xss=1>",原样文本\nhello,\n"look, out","注意, 小心"',
    )
  await importPage.getByRole('button', { name: '预览粘贴词表' }).click()
  assert.equal(await importPage.locator('img[src="x"]').count(), 0)
  assert.equal(await importPage.evaluate(() => window.__xss), undefined)
  assert.equal(await importPage.locator('[data-action="commit-import"]').isDisabled(), true)
  await importPage.locator('#skip-errors').check()
  await importPage.locator('[data-action="commit-import"]').click()
  await importPage.getByTestId('learned-count').waitFor()
  assert.match(await importPage.getByTestId('learned-count').innerText(), /0\s*\/\s*2/)
  await importPage.goto(baseURL + '/#settings')
  await importPage.locator('#backup-file').setInputFiles({
    name: 'valid-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backupState)),
  })
  await importPage.locator('#restore-confirm').check()
  await importPage.locator('[data-action="restore"]').click()
  await importPage.getByRole('status').filter({ hasText: '已恢复教材与复习记录' }).waitFor()
  const restoredArchive = await importPage.evaluate(async () =>
    (await import('/src/db.ts')).loadState(),
  )
  assert.equal(restoredArchive.words.length, 97)
  assert.deepEqual(restoredArchive.logs, backupState.logs)
  await importContext.close()
  assert.deepEqual(errors, [])
  await writeFile(
    'artifacts/word-review-verification.json',
    JSON.stringify(
      {
        passed: true,
        sourceRows: 97,
        uniqueWords: 97,
        persistedRatingsBeforeUndo: 2,
        independentDirections: true,
        reload: true,
        backup: true,
        validRestore: true,
        invalidBackupPreservesData: true,
        csvAndHtmlSafety: true,
        explicitErrorSkip: true,
        concurrentWrites: 'one accepted / one rejected',
        mobileOverflow: false,
        completionUndo: true,
        nativeSpeechPassed,
        voices,
        errors,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ passed: true, nativeSpeechPassed, checks: 16 }))
} finally {
  await browser.close()
}
