// Synthetic renderer QA. No real accounts, credentials, capture or user profile.
// DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-calendar-accounts.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { createServer } = require('node:http')
const desktop = resolve(__dirname, '..')
const { build } = require(
  require.resolve('esbuild', { paths: [require.resolve('vite', { paths: [desktop] })] })
)
const { chromium } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
async function main() {
  const output = fs.mkdtempSync(join(tmpdir(), 'ony308-calendar-ui-'))
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import ModelsView from './ModelsView'; import './assets/main.css'; createRoot(document.getElementById('root')).render(<ModelsView active={true} jump={{section:'calendar',n:1}}/>);`,
      resolveDir: join(desktop, 'src/renderer/src'),
      loader: 'tsx'
    },
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    outfile: join(output, 'app.js'),
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' }
  })
  fs.writeFileSync(
    join(output, 'index.html'),
    '<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script src="/app.js"></script></body></html>'
  )
  const server = createServer((req, res) => {
    const file =
      req.url === '/app.js' ? 'app.js' : req.url === '/app.css' ? 'app.css' : 'index.html'
    res.setHeader(
      'Content-Type',
      file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'
    )
    res.end(fs.readFileSync(join(output, file)))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      const off = () => () => {}
      window.notes = {
        models: async () => ({ models: [], ramGB: 16 }),
        getSettings: async () => ({}),
        onDownloadProgress: off
      }
      window.audio = { usage: async () => ({ bytes: 0, count: 0 }) }
      window.sync = { getStatus: async () => null, onStatus: off }
      window.integrations = { getAgentAccess: async () => null }
      window.detect = { getState: async () => ({ platform: 'darwin' }) }
      window.updates = { getState: async () => null, onState: off }
      const connections = ['microsoft', 'microsoft', 'google', 'google'].map((provider, i) => ({
        id: `account-${i}`,
        provider,
        email: `owner-${i}@example.test`,
        name: `QA account ${i}`,
        lastSyncIso: new Date().toISOString(),
        ...(i === 1 ? { error: 'This account needs to reconnect.', stale: true } : {})
      }))
      window.qa = {
        state: {
          configured: true,
          builtIn: true,
          signedIn: true,
          msSignedIn: true,
          googleSignedIn: true,
          googleAvailable: true,
          connections,
          calendars: connections.map((c) => ({
            id: `cal-${c.id}`,
            accountId: c.id,
            name: 'Calendar',
            colorHex: '#7c9769',
            isDefault: true
          })),
          events: [],
          prefs: { visibleCalendarIds: null, showMenuBar: true, showNoParticipants: true }
        },
        calls: [],
        listeners: []
      }
      const publish = () => {
        window.qa.listeners.forEach((fn) => fn(structuredClone(window.qa.state)))
        return structuredClone(window.qa.state)
      }
      window.calendar = {
        getState: async () => publish(),
        onEvents: (fn) => {
          window.qa.listeners.push(fn)
          return () => {}
        },
        refresh: async () => publish(),
        setPrefs: async (update) => {
          Object.assign(window.qa.state.prefs, update)
          return publish()
        },
        connectAccount: async (provider, id) => {
          window.qa.calls.push(['connect', provider, id])
          window.qa.state.connecting = { provider, accountId: id }
          return publish()
        },
        cancelAuth: async () => {
          window.qa.calls.push(['cancel'])
          delete window.qa.state.connecting
          return publish()
        },
        removeAccount: async (id) => {
          window.qa.calls.push(['remove', id])
          window.qa.state.connections = window.qa.state.connections.filter((c) => c.id !== id)
          window.qa.state.calendars = window.qa.state.calendars.filter((c) => c.accountId !== id)
          return publish()
        }
      }
    })
    for (const [width, height, theme] of [
      [1000, 760, 'light'],
      [800, 560, 'dark']
    ]) {
      await page.setViewportSize({ width, height })
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme)
      await page
        .getByRole('region', { name: 'Microsoft owner-0@example.test', exact: true })
        .waitFor()
      assert.equal(await page.getByRole('button', { name: /^Reconnect owner-/ }).count(), 4)
      const reconnect = page.getByRole('button', {
        name: 'Reconnect owner-1@example.test',
        exact: true
      })
      await reconnect.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: 'Cancel sign-in', exact: true }).click()
      await page.getByRole('button', { name: 'Remove owner-2@example.test', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: /^Reconnect owner-/ }).count(), 3)
      assert.deepEqual(await page.evaluate(() => window.qa.calls), [
        ['connect', 'microsoft', 'account-1'],
        ['cancel'],
        ['remove', 'account-2']
      ])
      assert.equal(await page.getByRole('alert').textContent(), 'This account needs to reconnect.')
      const toggle = page.getByRole('switch', {
        name: 'Show Calendar from owner-0@example.test in Coming up'
      })
      await toggle.click()
      assert.equal(await toggle.getAttribute('aria-checked'), 'false')
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true
      )
      await page.screenshot({ path: join(output, `${width}-${theme}.png`), fullPage: true })
    }
    assert.deepEqual(errors, [])
    console.log(
      `PASS: four account cards, targeted keyboard reconnect, cancel, single remove, selection, account errors, compact layout. Evidence: ${output}`
    )
  } finally {
    await browser.close()
    server.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
