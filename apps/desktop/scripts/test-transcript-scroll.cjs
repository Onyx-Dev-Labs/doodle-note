/* Real renderer with synthetic engine events; no audio capture or user profile.
 * DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-transcript-scroll.cjs
 * --baseline bundles MeetingView from the recorded Windows candidate before DEV-334.
 */
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join, resolve, dirname } = require('node:path')
const { createServer } = require('node:http')
const desktop = resolve(__dirname, '..')
const { build } = require(
  require.resolve('esbuild', { paths: [require.resolve('vite', { paths: [desktop] })] })
)
const { chromium } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const baseline = process.argv.includes('--baseline')
const output = mkdtempSync(join(tmpdir(), 'dev334-renderer-'))

async function main() {
  console.log('Synthetic renderer artifacts:', output, baseline ? '(baseline)' : '(working tree)')
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import MeetingView from './MeetingView'; import './assets/main.css';
        const root=createRoot(document.getElementById('root'));
        window.qaRender=(id='qa')=>root.render(<MeetingView key={id} meetingId={id} visible={true}
          autoRecord={false} autoRecordRequestId={null} isNewDraft={false} onAutoRecordStarted={()=>{}}
          onDraftSettled={()=>{}} onDiscardDraft={async()=>{}} onBack={()=>{}} onOpenSettings={()=>{}}/>);
        window.qaRender();`,
      resolveDir: join(desktop, 'src/renderer/src'),
      loader: 'tsx'
    },
    plugins: baseline
      ? [
          {
            name: 'baseline',
            setup(builder) {
              builder.onLoad({ filter: /MeetingView\.tsx$/ }, (args) => ({
                contents: execFileSync(
                  'git',
                  [
                    'show',
                    'c358268fc2fbabfb0419c6c8c8d5569db7799f2e:apps/desktop/src/renderer/src/MeetingView.tsx'
                  ],
                  { cwd: desktop, encoding: 'utf8' }
                ),
                loader: 'tsx',
                resolveDir: dirname(args.path)
              }))
            }
          }
        ]
      : [],
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    outfile: join(output, 'app.js'),
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' }
  })
  writeFileSync(
    join(output, 'index.html'),
    '<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script src="/app.js"></script></body></html>'
  )
  const server = createServer((req, res) => {
    const name =
      req.url === '/app.js' ? 'app.js' : req.url === '/app.css' ? 'app.css' : 'index.html'
    res.setHeader(
      'Content-Type',
      name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html'
    )
    res.end(readFileSync(join(output, name)))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      const listeners = new Set(),
        noEvent = () => () => {}
      const meeting = (id) => ({
        id,
        title: 'Synthetic scrolling QA',
        rawNotesMarkdown: 'Synthetic notes.',
        segments: [],
        participants: [],
        echoSuppressed: 0
      })
      window.qa = {
        starts: 0,
        stops: 0,
        records: { qa: meeting('qa'), second: meeting('second') },
        parts: [],
        send: (event) => listeners.forEach((cb) => cb(event))
      }
      window.meetings = {
        get: async (id) => window.qa.records[id],
        upsert: async (patch) => Object.assign(window.qa.records[patch.id], patch)
      }
      window.engine = {
        snapshot: async () => null,
        onEvent: (cb) => {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
        listInputDevices: async () => [],
        start: () => {
          window.qa.starts++
          window.qa.send({ event: 'started', command: 'live', binaryPath: 'synthetic' })
        },
        stop: () => {
          window.qa.stops++
          window.qa.send({ event: 'status', stage: 'finishing' })
        },
        setInputDevice: () => {}
      }
      window.notes = {
        onAskToken: noEvent,
        onEnhanceProgress: noEvent,
        models: async () => ({ models: [], ramGB: 16 }),
        getSettings: async () => ({ engineChoice: 'local' }),
        templates: async () => []
      }
      window.audio = { list: async () => window.qa.parts, read: async () => null }
      window.folders = { list: async () => [] }
      window.detect = { getState: async () => ({ platform: 'darwin' }), onMeetingEnded: noEvent }
    })
    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      )
    const send = async (event) => {
      await page.evaluate((event) => window.qa.send(event), event)
      await settle()
    }
    const metrics = () =>
      page.locator('.transcript-panel .tp-body').evaluate((el) => ({
        top: el.scrollTop,
        gap: el.scrollHeight - el.clientHeight - el.scrollTop,
        height: el.clientHeight
      }))
    const atBottom = async (label) => assert.ok((await metrics()).gap <= 2, label)
    const scrollTo = async (value) => {
      await page.locator('.transcript-panel .tp-body').evaluate((el, value) => {
        el.scrollTop = value === 'bottom' ? el.scrollHeight : value
      }, value)
      await settle()
    }
    const segment = (i) => ({
      id: 'synthetic-' + i,
      channel: 'mic',
      speaker: 'You',
      speakerId: 'mic',
      text: `Synthetic transcript line ${i}: the team reviewed the test plan and recorded its next steps.`,
      startMs: i * 2000,
      endMs: i * 2000 + 1000,
      confidence: 1
    })
    const failures = []
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByTitle('Start recording', { exact: true }).click()
    await send({ event: 'ready', channels: ['mic', 'system'] })
    await send({ event: 'partial', channel: 'mic', text: 'First synthetic words.' })
    await atBottom('Empty/short transcript starts following')
    await send({ event: 'segments', segments: Array.from({ length: 45 }, (_, i) => segment(i)) })
    await atBottom('Short transcript grows to overflowing while following')
    assert.ok((await metrics()).top > 500)
    const body = page.locator('.transcript-panel .tp-body')
    await body.hover()
    await page.mouse.wheel(0, -450)
    await page.waitForTimeout(200)
    const reading = await metrics()
    assert.ok(reading.gap > 100, 'Wheel can reach earlier text')
    await send({ event: 'partial', channel: 'mic', text: 'Incoming synthetic partial '.repeat(20) })
    if (Math.abs((await metrics()).top - reading.top) > 2)
      failures.push('Partial update moved the reading position')
    await scrollTo(200)
    const beforeFinal = await metrics()
    await send({ event: 'segments', segments: [segment(46)] })
    if (Math.abs((await metrics()).top - beforeFinal.top) > 2)
      failures.push('Final segment moved the reading position')
    assert.deepEqual(failures, [])
    await page.screenshot({ path: join(output, 'reading-while-streaming.png') })
    await scrollTo('bottom')
    await send({
      event: 'partial',
      channel: 'system',
      text: 'Following live partial text '.repeat(15)
    })
    await atBottom('Returning to bottom resumes partial following')
    await send({ event: 'segments', segments: [segment(47)] })
    await atBottom('Following resumes for final segments')
    await send({ event: 'partial', channel: 'mic', text: 'Long synthetic partial '.repeat(70) })
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight - 30
    })
    await settle()
    await send({ event: 'partial', channel: 'mic', text: 'Short partial.' })
    const clampedReading = await metrics()
    await send({ event: 'partial', channel: 'mic', text: 'Long synthetic partial '.repeat(70) })
    assert.ok(
      Math.abs((await metrics()).top - clampedReading.top) <= 2,
      'Content shrink clamping must not re-enable live follow without user scrolling'
    )
    assert.equal(await body.getAttribute('tabindex'), '0', 'Transcript is keyboard focusable')
    await body.focus()
    await page.keyboard.press('Home')
    await page.waitForTimeout(200)
    assert.ok((await metrics()).top < 3, 'Keyboard Home reaches earlier text')
    await send({
      event: 'partial',
      channel: 'mic',
      text: 'Keyboard reading survives incoming words.'
    })
    assert.ok((await metrics()).top < 3)
    await page.keyboard.press('End')
    await page.waitForTimeout(200)
    await send({ event: 'segments', segments: [segment(48)] })
    await atBottom('Keyboard End resumes following')
    // Scrollbar dragging uses the same native scroll event; direct scrollTop
    // represents its final position without platform-specific overlay geometry.
    await scrollTo(240)
    await send({
      event: 'partial',
      channel: 'mic',
      text: 'Scrollbar reading survives incoming words.'
    })
    assert.ok(Math.abs((await metrics()).top - 240) < 3)
    await page.getByRole('button', { name: 'Minimize transcript' }).click()
    await send({ event: 'segments', segments: [segment(49)] })
    await page.getByRole('button', { name: 'Show transcript', exact: true }).click()
    await settle()
    await atBottom('Reopening starts at latest text')
    await page.setViewportSize({ width: 800, height: 560 })
    await settle()
    await atBottom('Resizing preserves live following')
    await scrollTo(0)
    await page.setViewportSize({ width: 900, height: 650 })
    await settle()
    await send({ event: 'segments', segments: [segment(50)] })
    assert.ok((await metrics()).top < 3, 'Resizing while reading does not reset follow')
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await send({ event: 'done' })
    await send({ event: 'capture-finalized' })
    assert.equal(await page.locator('.transcript-panel').count(), 0, 'Stop still closes transcript')
    await page.getByTitle('Resume recording', { exact: true }).click()
    await send({ event: 'ready', channels: ['mic'] })
    await send({ event: 'segments', segments: [segment(51)] })
    await atBottom('Resume resets live follow')
    assert.equal(await page.evaluate(() => window.qa.starts), 2)
    assert.equal(await page.evaluate(() => window.qa.stops), 1)
    await scrollTo(0)
    await page.evaluate(() => window.qaRender('second'))
    await page.getByTitle('Start recording', { exact: true }).click()
    await send({ event: 'ready', channels: ['mic'] })
    await send({
      event: 'segments',
      segments: Array.from({ length: 30 }, (_, i) => segment(i + 100))
    })
    await atBottom('Meeting switch never inherits manual-scroll state')
    assert.deepEqual(errors, [])
    await page.screenshot({ path: join(output, 'following-latest.png') })
    console.log(
      'PASS: partial/final reading position, wheel/keyboard, native scroll events, follow resumption, short-to-overflow, hide/show, resize, Stop/Resume and meeting isolation'
    )
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
