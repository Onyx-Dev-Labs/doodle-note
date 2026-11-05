/* Synthetic native Electron renderer QA. No account, network service, microphone,
 * or customer data is used. Local MCP service entitlement is covered separately
 * by test-settings-redesign.cjs; this test covers the approved Settings gate.
 * Run: DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-remote-mcp-visibility.cjs
 */
const assert = require('node:assert/strict')
const { join } = require('node:path')
const { launchRenderer } = require('./fixtures/renderer-qa.cjs')

function init() {
  const noEvent = () => () => {}
  window.qa = {
    allowed: false,
    requests: 0,
    pending: [],
    mode: 'immediate',
    writes: [],
    mutations: 0
  }
  window.qa.status = {
    connected: true,
    enabled: false,
    connectionRevision: 0,
    statusRevision: 0,
    syncing: false,
    pendingCount: 0,
    linking: false,
    baseUrl: 'https://notes.example.test'
  }
  window.sync = {
    getStatus: async () => ({ ...window.qa.status }),
    onStatus: (cb) => {
      window.qa.onStatus = cb
      return () => {}
    },
    getRemoteMcpEligibility: () => {
      window.qa.requests++
      if (window.qa.mode === 'error') return Promise.reject(new Error('fixture offline'))
      if (window.qa.mode === 'pending')
        return new Promise((resolve) => window.qa.pending.push(resolve))
      return Promise.resolve(window.qa.allowed)
    },
    connect: () => {
      throw new Error('Unexpected cloud connection')
    },
    setEnabled: async (enabled) => {
      window.qa.mutations++
      window.qa.status.enabled = enabled
      return { ...window.qa.status }
    },
    syncNow: () => {
      throw new Error('Unexpected upload')
    },
    disconnect: async () => {
      window.qa.status.connected = false
      window.qa.status.connectionRevision++
      return { ...window.qa.status }
    }
  }
  window.qa.change = (values) => {
    Object.assign(window.qa.status, values)
    window.qa.status.statusRevision++
    window.qa.onStatus({ ...window.qa.status })
  }
  const agent = {
    enabled: false,
    configPath: '/fixture/mcp.json',
    server: { command: 'fixture-mcp', args: [], env: {} },
    clients: [{ id: 'codex', name: 'Codex', installed: true, connected: false }]
  }
  window.integrations = {
    getAgentAccess: async () => ({ ...agent }),
    setAgentAccess: async (enabled) => {
      agent.enabled = enabled
      return { ...agent }
    },
    connectClient: async () => {
      agent.clients = [{ ...agent.clients[0], connected: true }]
      return { ...agent }
    },
    disconnectClient: async () => {
      agent.clients = [{ ...agent.clients[0], connected: false }]
      return { ...agent }
    }
  }
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: async (text) => {
        window.qa.writes.push(text)
      }
    }
  })
  window.audio = { usage: async () => ({ bytes: 0, count: 0 }) }
  window.calendar = { getState: async () => null, onEvents: noEvent }
  window.detect = { getState: async () => null }
  window.updates = { getState: async () => ({ supported: false }), onState: noEvent }
  window.notes = {
    models: async () => ({ models: [], ramGB: 16 }),
    getSettings: async () => ({ engineChoice: 'local' }),
    onDownloadProgress: noEvent
  }
}
async function main() {
  const { runtime, page, output, errors } = await launchRenderer({
    name: 'remote-mcp-ui',
    init,
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import ModelsView from './ModelsView'; import './assets/main.css'; import './assets/redesign-type.css';
      const root=createRoot(document.getElementById('root'));
      window.showSettings=(active=true)=>root.render(<ModelsView active={active} jump={{section:'integrations',n:1}}/>);
      window.showSettings();`
  })
  console.log('Renderer QA artifacts:', output)
  try {
    await page.locator('.settings-cloud-controls').waitFor()
    const remote = page.locator('.remote-mcp')
    const focus = () => page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const locked = async () => {
      await page.waitForFunction(
        () => document.querySelector('.settings-cloud-controls')?.inert === true
      )
      assert.equal(
        await page.locator('.settings-cloud-controls').getAttribute('aria-hidden'),
        'true'
      )
      assert.equal(
        await page.getByRole('switch', { name: 'Allow local AI agents to read meetings' }).count(),
        0
      )
    }
    const unlocked = async () => {
      await page.waitForFunction(
        () => document.querySelector('.settings-cloud-controls')?.inert === false
      )
      await remote.waitFor({ state: 'visible' })
      assert.equal(await page.locator('.settings-cloud-controls').getAttribute('aria-hidden'), null)
    }
    const finishAll = (allowed) =>
      page.evaluate((allowed) => {
        const pending = window.qa.pending.splice(0)
        pending.forEach((resolve) => resolve(allowed))
      }, allowed)
    await page.waitForFunction(() => window.qa.requests > 0)
    await locked()
    assert.equal(await remote.count(), 0)
    await page
      .locator('.settings-cloud-unlock')
      .getByRole('button', { name: 'Get Cloud Sync', exact: true })
      .waitFor()
    await page.screenshot({ path: join(output, 'unpaid.png') })

    // Presentation is locked, including Local MCP. No subscription requirement
    // is added to the underlying local service; its own opt-in tests remain.
    await page.evaluate(() => {
      window.qa.mode = 'pending'
      window.dispatchEvent(new Event('focus'))
    })
    await locked()
    await finishAll(true)
    await unlocked()
    assert.equal(
      await page.evaluate(() => window.qa.status.enabled),
      false,
      'paused uploads still allow paid setup'
    )
    await page.getByRole('switch', { name: 'Allow local AI agents to read meetings' }).click()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page
      .locator('.keys-section')
      .filter({ has: page.getByRole('heading', { name: 'Local MCP', exact: true }) })
      .getByRole('button', { name: 'Disconnect', exact: true })
      .waitFor()
    await page.getByRole('button', { name: 'Copy snippet' }).click()
    assert.match(await page.evaluate(() => window.qa.writes.at(-1)), /mcpServers/)
    await page.getByRole('button', { name: 'Copy server URL' }).click()
    assert.equal(
      await page.evaluate(() => window.qa.writes.at(-1)),
      'https://notes.example.test/api/mcp'
    )
    await page.screenshot({ path: join(output, 'paid.png') })

    // Both the outer Settings gate and inner remote-MCP component refresh.
    // Resolve all current requests, not an assumed implementation-specific count.
    await focus()
    await locked()
    const olderCount = await page.evaluate(() => window.qa.pending.length)
    await focus()
    await page.evaluate((olderCount) => {
      const older = window.qa.pending.splice(0, olderCount)
      window.qa.pending.splice(0).forEach((resolve) => resolve(false))
      older.forEach((resolve) => resolve(true))
    }, olderCount)
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    )
    await locked()

    await focus()
    const previousCount = await page.evaluate(() => window.qa.pending.length)
    await page.evaluate(() => window.qa.change({ connectionRevision: 1 }))
    await page.waitForFunction(
      (previousCount) => window.qa.pending.length > previousCount,
      previousCount
    )
    await page.evaluate((previousCount) => {
      const previous = window.qa.pending.splice(0, previousCount)
      window.qa.pending.splice(0).forEach((resolve) => resolve(false))
      previous.forEach((resolve) => resolve(true))
    }, previousCount)
    await locked()
    await page.evaluate(() => {
      window.qa.mode = 'immediate'
      window.qa.allowed = true
      window.dispatchEvent(new Event('focus'))
    })
    await unlocked()
    await page.evaluate(() => window.qa.change({ connected: false, connectionRevision: 2 }))
    await locked()
    assert.equal(await remote.count(), 0)
    // A late getStatus-style event cannot restore the prior connection.
    await page.evaluate(() =>
      window.qa.onStatus({
        ...window.qa.status,
        connected: true,
        connectionRevision: 1,
        statusRevision: window.qa.status.statusRevision - 1
      })
    )
    await locked()

    await page.evaluate(() => window.qa.change({ connected: true, connectionRevision: 3 }))
    await unlocked()
    await page.evaluate(() => {
      window.qa.mode = 'error'
      window.dispatchEvent(new Event('focus'))
    })
    await locked()
    await page.evaluate(() => {
      window.qa.mode = 'immediate'
      window.dispatchEvent(new Event('online'))
    })
    await unlocked()
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await locked()
    await focus()
    await unlocked()

    await page.getByRole('button', { name: 'General', exact: true }).click()
    await page.evaluate(() => {
      window.qa.mode = 'pending'
    })
    await page.getByRole('button', { name: 'Get more', exact: true }).click()
    await locked()
    await finishAll(true)
    await unlocked()
    await page.evaluate(() => window.showSettings(false))
    await locked()
    await page.evaluate(() => window.showSettings(true))
    await page.waitForFunction(() => window.qa.pending.length > 0)
    await locked()
    await finishAll(true)
    await unlocked()

    await runtime.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(850, 680)
    )
    await page.getByRole('button', { name: 'Copy server URL' }).focus()
    await page.keyboard.press('Enter')
    assert.equal(
      await page.evaluate(() => window.qa.writes.at(-1)),
      'https://notes.example.test/api/mcp'
    )
    await page.screenshot({ path: join(output, 'paid-compact.png') })
    await page.evaluate(() => {
      window.qa.mode = 'immediate'
      window.qa.allowed = false
      window.dispatchEvent(new Event('focus'))
    })
    await locked()
    assert.equal(await page.locator('#remote-mcp-url').count(), 0)
    assert.equal(
      await page.evaluate(() => window.qa.mutations),
      0,
      'UI checks must not change sync or upload'
    )
    assert.deepEqual(errors, [])
    console.log(
      'PASS: Get more lock, paid Local MCP controls, remote copy/keyboard, stale requests/account events, disconnect, failure/retry, offline, reopen, and compact layout.'
    )
  } finally {
    await runtime.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
