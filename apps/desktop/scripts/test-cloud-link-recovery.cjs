// Development-only smoke: real Electron IPC and UI, isolated data, synthetic loopback account.
// DOODLE_PLAYWRIGHT_MODULE must resolve a separately installed Playwright module.
const { _electron, expect } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright/test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync } = require('node:fs')
const { createServer } = require('node:http')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const root = resolve(__dirname, '..')
const profile = mkdtempSync(join(tmpdir(), 'doodle-cloud-link-qa-'))
const artifacts = process.env.DOODLE_QA_ARTIFACTS || join(profile, 'screenshots')
mkdirSync(artifacts, { recursive: true })

async function main() {
  const cloud = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ meetings: [], folders: [], hasMore: false, ok: true }))
  })
  await new Promise((resolve) => cloud.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${cloud.address().port}`
  let app
  try {
    app = await _electron.launch({
      executablePath: require('electron'), args: [root],
      env: { ...process.env, DOODLE_USER_DATA: profile, DOODLE_SYNC_URL: baseUrl }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ shell, safeStorage }) => {
      globalThis.qaLinks = []
      globalThis.qaLaunchFails = false
      shell.openExternal = async (url) => {
        if (globalThis.qaLaunchFails) throw new Error('synthetic private launch detail')
        globalThis.qaLinks.push(url)
      }
      // Avoid Keychain interaction for this synthetic account. Production still uses safeStorage.
      safeStorage.encryptString = (value) => Buffer.from(value)
      safeStorage.decryptString = (value) => value.toString()
    })
    await page.evaluate(() => {
      localStorage.setItem('doodle-onboarding-done', '1')
      localStorage.setItem('doodle-setup-wizard-done', '1')
    })
    await page.reload()
    const settings = async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Cloud sync', exact: true }).click()
    }
    const connect = () => page.getByRole('button', { name: 'Connect DoodleNote Cloud', exact: true })
    const cancel = () => page.getByRole('button', { name: 'Cancel', exact: true })
    const status = () => page.evaluate(() => window.sync.getStatus())
    const lastUrl = () => app.evaluate(() => globalThis.qaLinks.at(-1))
    const callback = (url, token = 'dnsy_synthetic_qa') =>
      `http://127.0.0.1:${new URL(url).searchParams.get('port')}/callback?token=${token}&email=qa%40example.test`
    await settings()
    await connect().click()
    await expect(cancel()).toBeEnabled()
    const oldUrl = await lastUrl()
    // Focus/return and Settings navigation cannot imply browser abandonment.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('button', { name: 'General', exact: true }).click()
    await page.getByRole('button', { name: 'Cloud sync', exact: true }).click()
    await expect(cancel()).toBeEnabled()
    assert.equal((await status()).linking, true)
    await page.screenshot({ path: join(artifacts, 'settings-pending.png') })
    await cancel().focus()
    await page.keyboard.press('Enter')
    await expect(connect()).toBeEnabled()
    await connect().click()
    await expect(cancel()).toBeEnabled()
    await assert.rejects(fetch(callback(oldUrl)))
    // Reload/remount reconstructs pending state from main process.
    await page.reload()
    await settings()
    await expect(cancel()).toBeEnabled()
    await cancel().click()
    await expect(connect()).toBeEnabled()
    await app.evaluate(() => { globalThis.qaLaunchFails = true })
    await connect().click()
    await expect(page.getByText('Could not open your browser — try again', { exact: true })).toBeVisible()
    await expect(connect()).toBeEnabled()
    await page.screenshot({ path: join(artifacts, 'launch-failure.png') })
    await app.evaluate(() => { globalThis.qaLaunchFails = false })
    await connect().click()
    await expect(cancel()).toBeEnabled()
    await fetch(callback(await lastUrl(), 'invalid_fixture'))
    await expect(page.getByText('The browser did not return a valid token', { exact: true })).toBeVisible()
    await expect(connect()).toBeEnabled()
    // Accelerate only the link timeout in this isolated process.
    await app.evaluate(() => {
      const original = globalThis.setTimeout
      globalThis.qaOriginalSetTimeout = original
      globalThis.setTimeout = (fn, ms, ...args) => original(fn, ms === 300000 ? 100 : ms, ...args)
    })
    await connect().click()
    await expect(page.getByText('Sign-in timed out — try again', { exact: true })).toBeVisible()
    await expect(connect()).toBeEnabled()
    await app.evaluate(() => {
      globalThis.setTimeout = globalThis.qaOriginalSetTimeout
    })
    // Start in Settings, then mount the tour over a live attempt.
    await connect().click()
    await expect(cancel()).toBeEnabled()
    await page.getByRole('button', { name: 'General', exact: true }).click()
    await page.getByRole('button', { name: 'Show tour', exact: true }).click()
    const tour = page.getByRole('dialog', { name: 'Welcome tour' })
    await tour.getByRole('button', { name: 'Show me around', exact: true }).click()
    for (let i = 0; i < 3; i++) await tour.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(tour.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
    await page.screenshot({ path: join(artifacts, 'onboarding-pending.png') })
    await tour.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(tour.getByRole('button', { name: 'Connect cloud sync', exact: true })).toBeEnabled()
    await tour.getByRole('button', { name: 'Connect cloud sync', exact: true }).click()
    await expect(tour.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
    const linked = await fetch(callback(await lastUrl()), { redirect: 'manual' })
    assert.equal(linked.status, 302)
    await expect(tour.getByText(/Synced as qa@example.test/)).toBeVisible()
    assert.equal((await status()).connected, true)
    await tour.getByRole('button', { name: 'Skip tour', exact: true }).click()
    await page.getByRole('button', { name: 'Cloud sync', exact: true }).click()
    await expect(page.getByText('qa@example.test', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(artifacts, 'connected.png') })
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(connect()).toBeEnabled()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 650))
    await connect().click()
    await expect(cancel()).toBeInViewport()
    await page.screenshot({ path: join(artifacts, 'compact-pending.png') })
    await cancel().click()
    assert.equal((await status()).enabled, false)
    console.log('Cloud-link UI smoke passed: cancel/retry, keyboard, focus, navigation/remount, launch/invalid/timeout errors, onboarding and mounted Settings success, disconnect, compact layout.')
  } finally {
    if (app) await app.close()
    cloud.closeAllConnections()
    await new Promise((resolve) => cloud.close(resolve))
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
