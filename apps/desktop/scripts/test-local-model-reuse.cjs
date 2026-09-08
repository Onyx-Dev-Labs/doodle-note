// Optional real Electron/Qwen smoke. Requires an existing compatible DoodleNote
// model and Playwright. ASR preflight is stubbed; no recording or download.
const { _electron: electron, expect } = require(
  process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright/test'
)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ony-278-ui-'))
const artifacts =
  process.env.DOODLE_QA_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'ony-278-evidence-'))
fs.mkdirSync(artifacts, { recursive: true })
let app
async function launch() {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, DOODLE_USER_DATA: profile }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('wizard:preflight')
    ipcMain.handle('wizard:preflight', () => ({ ok: true }))
    BrowserWindow.getAllWindows()[0].setTitle('DoodleNote — ONY-278 local model QA')
  })
  return page
}
;(async () => {
  let page = await launch()
  await page.getByRole('button', { name: 'Get started', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('✓ ready', { exact: true })).toBeVisible({ timeout: 60000 })
  await page.screenshot({ path: path.join(artifacts, 'setup-reused.png') })
  const models = await page.evaluate(() => window.notes.models())
  const qwen = models.models.find((m) => m.id === 'qwen3-4b-instruct')
  assert.ok(qwen?.downloaded && qwen?.available)
  await page.evaluate(() => {
    globalThis.qaModelEvents = []
    window.notes.onDownloadProgress((ev) => globalThis.qaModelEvents.push(ev))
  })
  const [activated, duplicate] = await page.evaluate(() =>
    Promise.all([
      window.notes.activateModel('qwen3-4b-instruct'),
      window.notes.activateModel('qwen3-4b-instruct')
    ])
  )
  assert.equal(activated.ok, true, activated.error)
  assert.equal(duplicate.ok, false)
  assert.match(duplicate.error, /operation is running/)
  const events = await page.evaluate(() => globalThis.qaModelEvents)
  assert.deepEqual(
    events.map((e) => e.stage),
    ['checking', 'loading']
  )
  assert.equal(fs.existsSync(path.join(profile, 'models')), false)
  const settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'))
  assert.equal(settings.activeLocalModelId, 'qwen3-4b-instruct')
  assert.equal(settings.cloud, undefined, 'another profile settings were not imported')
  await page.evaluate(() => {
    localStorage.setItem('doodle-onboarding-done', '1')
    localStorage.setItem('doodle-setup-wizard-done', '1')
  })
  await app.close()
  page = await launch()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Notes model', exact: true }).click()
  const card = page.locator('.model-card').filter({ hasText: 'Qwen3 4B' })
  await expect(card.getByText('Active', { exact: true })).toBeVisible({ timeout: 60000 })
  await page.screenshot({ path: path.join(artifacts, 'settings-restarted.png') })
  // Controlled UI-only phase/error fixtures; real activation was exercised above.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('notes:models')
    ipcMain.handle('notes:models', () => ({
      ramGB: 16,
      models: [
        {
          id: 'fixture',
          label: 'Fast',
          description: 'Qwen3 4B UI fixture',
          sizeGB: 2.4,
          minRamGB: 8,
          available: true,
          downloaded: true,
          active: false
        }
      ]
    }))
    ipcMain.removeHandler('notes:activate-model')
    ipcMain.handle('notes:activate-model', async () => {
      const send = (stage, progress = 0) =>
        BrowserWindow.getAllWindows()[0].webContents.send('notes:download-progress', {
          modelId: 'fixture',
          stage,
          progress
        })
      send('checking')
      await new Promise((r) => setTimeout(r, 1000))
      send('loading')
      await new Promise((r) => setTimeout(r, 1500))
      return { ok: false, error: 'Local model is unreadable. Please retry.' }
    })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Notes model', exact: true }).click()
  await page.getByRole('button', { name: 'Activate', exact: true }).click()
  await expect(page.getByText('Checking local models…', { exact: true })).toBeVisible()
  await expect(page.getByText('Loading local model…', { exact: true })).toBeVisible()
  assert.equal(await page.locator('.progress-track').count(), 0)
  await page.screenshot({ path: path.join(artifacts, 'loading-local.png') })
  await expect(page.getByText('Local model is unreadable. Please retry.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Activate', exact: true })).toBeEnabled()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 560))
  await page.getByRole('button', { name: 'Activate', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(artifacts, 'error-compact.png') })
  console.log(
    JSON.stringify({ result: 'PASS', events, artifacts, profileCreatedNoModelCopy: true })
  )
})()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await app?.close().catch(() => {})
    fs.rmSync(profile, { recursive: true, force: true })
  })
