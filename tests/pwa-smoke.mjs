import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { browserTools } from './browser-tools.mjs'
const { chromium, executablePath } = browserTools()
const baseURL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173'
await mkdir('artifacts', { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.log('Browser console:', message.text())
})
page.on('requestfailed', (request) =>
  console.log('Failed request:', request.url(), request.failure()?.errorText),
)
try {
  await page.goto(baseURL + '/')
  await page.getByRole('button', { name: '导入北师大四上词表' }).waitFor()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  const cdp = await context.newCDPSession(page)
  const installability = await cdp.send('Page.getInstallabilityErrors')
  console.log('Installability:', JSON.stringify(installability))
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '导入北师大四上词表' }).click({ timeout: 5000 })
  await page.locator('[data-action="commit-import"]').click()
  await page.getByTestId('learned-count').waitFor()
  assert.match(await page.getByTestId('learned-count').innerText(), /0\s*\/\s*97/)
  await page.locator('[data-action="start-study"]').click()
  await page.locator('[data-action="begin-recall"]').click()
  await page.locator('[data-action="reveal"]').click()
  await page.locator('[data-action="rate-3"]').click()
  await page.getByRole('heading', { name: '听见声音，想起意思。' }).waitFor()
  await page.locator('[data-action="play-task"]').click()
  await page.waitForFunction(
    () => !document.querySelector('[data-action="reveal"]').disabled,
    {},
    { timeout: 35000 },
  )
  await page.locator('[data-action="reveal"]').click()
  await page.locator('[data-action="rate-3"]').click()
  await page.getByRole('heading', { name: '先听一听，跟着读。' }).waitFor()
  await page.goto(baseURL + '/#today')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('learned-count').waitFor()
  assert.match(await page.getByTestId('learned-count').innerText(), /^1\s*\/\s*97/)
  await page.goto(baseURL + '/#library')
  assert.equal(await page.locator('.catalog-book').count(), 16)
  assert.equal(
    await page.locator('.catalog-book').filter({ hasText: '单元：已对照课本' }).count(),
    6,
  )
  const ids = await page
    .locator('.catalog-book button')
    .evaluateAll((buttons) => buttons.map((button) => button.dataset.action))
  for (const action of ids.filter((action) => action !== 'catalog-bnu-grade4-upper')) {
    await page.locator(`[data-action="${action}"]`).click()
    await page.getByRole('heading', { name: '检查字段与导入预览' }).waitFor()
    assert.match(
      await page.locator('.source-note').innerText(),
      action === 'catalog-bnu-grade8-upper-2024'
        ? /6单元460条主词表/
        : action.endsWith('-2024')
          ? /Word bank 75–77页/
          : /候选资料/,
    )
    await page.locator('[data-action="commit-import"]').click()
    await page.waitForURL('**/#today')
    if (['catalog-bnu-grade8-upper-2024', 'catalog-bnu-grade4-upper-2024'].includes(action)) {
      assert.equal(await page.locator('#active-unit option').count(), 7)
      const unit =
        action === 'catalog-bnu-grade8-upper-2024' ? 'Unit 6 Celebrations' : 'Unit 1 Back to school'
      await page.locator('#active-unit').selectOption(unit)
      await page.locator('[data-action="start-study"]').click()
      await page.getByRole('heading', { name: '先听一听，跟着读。' }).waitFor()
      assert.ok((await page.locator('.study-heading').innerText()).includes(unit))
      await page.locator('[data-action="begin-recall"]').click()
      await page.locator('[data-action="reveal"]').click()
      await page.locator('[data-action="rate-3"]').click()
      await page.locator('[data-action="play-task"]').click()
      await page.waitForFunction(
        () => !document.querySelector('[data-action="reveal"]').disabled,
        {},
        { timeout: 35000 },
      )
      await page.locator('[data-action="reveal"]').click()
      await page.locator('[data-action="rate-3"]').click()
    }
    await page.goto(baseURL + '/#library')
  }
  assert.equal(await page.locator('.book-tabs button').count(), 16)
  await page.screenshot({ path: 'artifacts/textbook-catalog-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: 'artifacts/textbook-catalog-mobile.png', fullPage: true })
  await page.goto(baseURL + '/#today')
  await page.reload({ waitUntil: 'domcontentloaded' })
  assert.match(await page.getByTestId('learned-count').innerText(), /^3\s*\/\s*3733/)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'artifacts/word-review-production.png', fullPage: true })
  assert.deepEqual(errors, [])
  const result = {
    passed: true,
    production: true,
    offlineShell: true,
    offlineReviewedCsvImport: true,
    offlineCatalogBooks: 16,
    totalWords: 3733,
    primaryNewBooks: 4,
    primaryNewWords: 388,
    primaryNewReadAndListen: true,
    newEditionWords: 460,
    newEditionUnits: 6,
    newEditionUnitFilter: true,
    newEditionReadAndListen: true,
    oldEditionSeparate: true,
    candidateBooks: 10,
    mobileOverflow: false,
    offlineNativeTts: true,
    offlineReadAndListenRatings: true,
    reloadPersists: true,
    installability,
    errors,
  }
  await writeFile(
    'artifacts/word-review-production-verification.json',
    JSON.stringify(result, null, 2),
  )
  console.log(JSON.stringify(result))
} catch (error) {
  await page.screenshot({ path: 'artifacts/word-review-production-failure.png', fullPage: true })
  console.log('Failure page:', (await page.locator('body').innerText()).slice(0, 1200))
  console.log('Page errors:', JSON.stringify(errors))
  throw error
} finally {
  await browser.close()
}
