/* Synthetic renderer QA. No account, network service, microphone or customer data is used.
 * Run: DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-remote-mcp-visibility.cjs
 */
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve, dirname } = require('node:path')
const { createServer } = require('node:http')
const desktop = resolve(__dirname, '..')
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite', { paths: [desktop] })] }))
const { chromium } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const output = mkdtempSync(join(tmpdir(), 'ony279-renderer-'))

async function main() {
  console.log('Renderer QA artifacts:', output)
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import ModelsView from './ModelsView'; import './assets/main.css';
        const root=createRoot(document.getElementById('root'));
        window.showSettings=(active=true)=>root.render(<ModelsView active={active} jump={{section:'integrations',n:1}}/>);
        window.showSettings();`,
      resolveDir: join(desktop, 'src/renderer/src'), loader: 'tsx'
    }, bundle: true, format: 'iife', jsx: 'automatic', outfile: join(output, 'app.js'),
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' }
  })
  writeFileSync(join(output, 'index.html'), '<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root" style="height:100vh"></div><script src="/app.js"></script></body></html>')
  const server = createServer((req, res) => {
    const name = req.url === '/app.js' ? 'app.js' : req.url === '/app.css' ? 'app.css' : 'index.html'
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html')
    res.end(readFileSync(join(output, name)))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 920 } })
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      const noEvent = () => () => {}
      window.qa = { allowed: false, requests: 0, pending: [], mode: 'immediate', writes: [], mutations: 0 }
      window.qa.status = { connected: true, enabled: false, connectionRevision: 0, syncing: false,
        pendingCount: 0, linking: false, baseUrl: 'https://notes.example.test' }
      window.sync = {
        getStatus: async () => ({ ...window.qa.status }),
        onStatus: cb => { window.qa.onStatus = cb; return () => {} },
        getRemoteMcpEligibility: () => {
          window.qa.requests++
          if (window.qa.mode === 'error') return Promise.reject(new Error('fixture offline'))
          if (window.qa.mode === 'pending') return new Promise(resolve => window.qa.pending.push(resolve))
          return Promise.resolve(window.qa.allowed)
        },
        connect: () => { throw new Error('Unexpected cloud connection') },
        setEnabled: async enabled => { window.qa.mutations++; window.qa.status.enabled = enabled; return {...window.qa.status} },
        syncNow: () => { throw new Error('Unexpected upload') },
        disconnect: async () => { window.qa.status.connected=false; window.qa.status.connectionRevision++; return {...window.qa.status} }
      }
      window.qa.change = values => { Object.assign(window.qa.status, values); window.qa.onStatus({...window.qa.status}) }
      const agent = { enabled: false, configPath: '/fixture/mcp.json', server: {command: 'fixture-mcp',args:[],env:{}},
        clients: [{id:'codex',name:'Codex',installed:true,connected:false}] }
      window.integrations = {
        getAgentAccess: async () => ({...agent}),
        setAgentAccess: async enabled => { agent.enabled=enabled; return {...agent} },
        connectClient: async () => { agent.clients=[{...agent.clients[0],connected:true}]; return {...agent} },
        disconnectClient: async () => { agent.clients=[{...agent.clients[0],connected:false}]; return {...agent} }
      }
      Object.defineProperty(navigator, 'clipboard', {value:{writeText:async text => {window.qa.writes.push(text)}}})
      window.audio = {usage:async()=>({bytes:0,count:0})}
      window.calendar = {getState:async()=>null,onEvents:noEvent}
      window.detect = {getState:async()=>null}
      window.updates = {getState:async()=>({supported:false}),onState:noEvent}
      window.notes = {models:async()=>({models:[],ramGB:16}),getSettings:async()=>({engineChoice:'local'}),onDownloadProgress:noEvent}
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const remote = page.locator('.remote-mcp')
    const hidden = async () => { await page.waitForFunction(() => !document.querySelector('.remote-mcp')) }
    const visible = async () => { await remote.waitFor({state:'visible'}) }
    const focus = async () => page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('heading',{name:'Local MCP',exact:true}).waitFor()
    await page.waitForFunction(() => window.qa.requests > 0)
    await hidden()
    await page.screenshot({path:join(output,'unpaid.png')})

    // Actual Local MCP controls remain usable on an unpaid profile.
    await page.getByRole('switch',{name:'Allow local AI agents to read meetings'}).click()
    await page.getByRole('button',{name:'Connect',exact:true}).click()
    await page.getByRole('button',{name:'Disconnect',exact:true}).waitFor()
    await page.getByRole('button',{name:'Copy snippet'}).click()
    assert.match(await page.evaluate(()=>window.qa.writes.at(-1)), /mcpServers/)

    await page.evaluate(()=>{window.qa.mode='pending';window.dispatchEvent(new Event('focus'))})
    await hidden()
    await page.evaluate(()=>window.qa.pending.shift()(true))
    await visible()
    assert.equal(await page.evaluate(()=>window.qa.status.enabled), false, 'paused uploads still allow paid setup')
    await page.getByRole('button',{name:'Copy server URL'}).click()
    assert.equal(await page.evaluate(()=>window.qa.writes.at(-1)), 'https://notes.example.test/api/mcp')
    await page.screenshot({path:join(output,'paid.png')})

    // A newer request wins even when an earlier grant arrives last.
    await focus()
    await hidden()
    await focus()
    await page.evaluate(()=>{const [old,newer]=window.qa.pending.splice(0);newer(false);old(true)})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await hidden()

    // Remount and invalidate when account revision changes, even if still connected.
    await focus()
    await page.evaluate(()=>window.qa.change({connectionRevision:1}))
    await page.waitForFunction(()=>window.qa.pending.length===2)
    await page.evaluate(()=>{const [old,current]=window.qa.pending.splice(0);current(false);old(true)})
    await hidden()
    await page.evaluate(()=>{window.qa.mode='immediate';window.qa.allowed=true;window.dispatchEvent(new Event('focus'))})
    await visible()
    await page.evaluate(()=>window.qa.change({connected:false,connectionRevision:2}))
    await hidden()
    // A late getStatus-style event cannot restore the prior connection.
    await page.evaluate(()=>window.qa.onStatus({...window.qa.status,connected:true,connectionRevision:1}))
    await hidden()

    await page.evaluate(()=>window.qa.change({connected:true,connectionRevision:3}))
    await visible()
    await page.evaluate(()=>{window.qa.mode='error';window.dispatchEvent(new Event('focus'))})
    await hidden()
    await page.evaluate(()=>{window.qa.mode='immediate';window.dispatchEvent(new Event('online'))})
    await visible()
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')))
    await hidden()
    await focus()
    await visible()

    // Navigating away and reopening starts pending instead of reusing a grant.
    await page.getByRole('button',{name:'General',exact:true}).click()
    await page.evaluate(()=>{window.qa.mode='pending'})
    await page.getByRole('button',{name:'Integrations',exact:true}).click()
    await hidden()
    await page.evaluate(()=>window.qa.pending.shift()(true))
    await visible()
    await page.evaluate(()=>window.showSettings(false))
    await hidden()
    await page.evaluate(()=>window.showSettings(true))
    await page.waitForFunction(()=>window.qa.pending.length===1)
    await hidden()
    await page.evaluate(()=>{window.qa.mode='immediate';window.qa.allowed=true;window.qa.pending.shift()(true)})
    await visible()

    await page.setViewportSize({width:850,height:680})
    await page.getByRole('button',{name:'Copy server URL'}).focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(()=>window.qa.writes.at(-1)), 'https://notes.example.test/api/mcp')
    await page.screenshot({path:join(output,'paid-compact.png')})
    await page.evaluate(()=>{window.qa.allowed=false;window.dispatchEvent(new Event('focus'))})
    await hidden()
    assert.equal(await page.locator('#remote-mcp-url').count(),0)
    assert.equal(await page.evaluate(()=>window.qa.mutations),0)
    assert.deepEqual(errors,[])
    console.log(`PASS: paid/unpaid, Local MCP controls, copy/keyboard, pending, stale responses, account/disconnect, failure/retry, offline, reopen and compact layout. Screenshots: ${output}`)
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)) }
}
main().catch(error=>{console.error(error);process.exitCode=1})
