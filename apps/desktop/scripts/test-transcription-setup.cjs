/* Controlled renderer QA: real wizard and CSS, synthetic preflight only.
 * DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-transcription-setup.cjs
 * --baseline reproduces static loading / rejected-call behavior on the recorded base.
 * No model downloads, OS permissions, capture, or user profile access.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const { createServer } = require('node:http')
const desktop = path.resolve(__dirname, '..')
const { build } = require(
  require.resolve('esbuild', { paths: [require.resolve('vite', { paths: [desktop] })] })
)
const { chromium } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const baseline = process.argv.includes('--baseline')
const artifacts =
  process.env.DOODLE_QA_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'ony277-evidence-'))
const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'ony277-renderer-'))
fs.mkdirSync(artifacts, { recursive: true })

async function main() {
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import FirstRunWizard from './FirstRunWizard'; import './assets/main.css';
        const root = createRoot(document.getElementById('root'));
        let session = 0;
        window.qa.mount = () => root.render(<FirstRunWizard key={++session} onFinish={() => root.render(<p>Setup closed</p>)} />);
        window.qa.mount();`,
      resolveDir: path.join(desktop, 'src/renderer/src'),
      loader: 'tsx'
    },
    plugins: baseline
      ? [
          {
            name: 'baseline',
            setup(builder) {
              builder.onLoad({ filter: /(?:FirstRunWizard\.tsx|main\.css)$/ }, (args) => ({
                contents: execFileSync(
                  'git',
                  [
                    'show',
                    '68fbc7c0507c536ce04caed03dabf19f4935ede4:apps/desktop/src/renderer/src/' +
                      path.relative(path.join(desktop, 'src/renderer/src'), args.path)
                  ],
                  { cwd: desktop, encoding: 'utf8' }
                ),
                loader: args.path.endsWith('.css') ? 'css' : 'tsx',
                resolveDir: path.dirname(args.path)
              }))
            }
          }
        ]
      : [],
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    outfile: path.join(bundle, 'app.js'),
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' }
  })
  const server = createServer((req, res) => {
    if (req.url === '/app.js' || req.url === '/app.css') {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css')
      res.end(fs.readFileSync(path.join(bundle, req.url.slice(1))))
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.end(
        '<!doctype html><html lang="en"><head><title>ONY-277 controlled wizard QA</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
      )
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const context = await browser.newContext({
      viewport: { width: 800, height: 560 },
      recordVideo: { dir: artifacts, size: { width: 800, height: 560 } }
    })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      const listeners = new Set()
      const notesListeners = new Set()
      const attempts = []
      window.qa = {
        platform: 'darwin',
        attempts,
        listeners: () => [listeners.size, notesListeners.size],
        send: (event) => listeners.forEach((cb) => cb(event)),
        resolve: (result, index = attempts.length - 1) => attempts[index].resolve(result),
        reject: (index = attempts.length - 1) =>
          attempts[index].reject(new Error('Synthetic IPC failure'))
      }
      window.detect = { getState: async () => ({ platform: window.qa.platform }) }
      window.wizard = {
        onPreflightEvent: (cb) => {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
        runPreflight: () => new Promise((resolve, reject) => attempts.push({ resolve, reject }))
      }
      window.notes = {
        models: async () => ({ models: [], ramGB: 16 }),
        onDownloadProgress: (cb) => {
          notesListeners.add(cb)
          return () => notesListeners.delete(cb)
        }
      }
    })
    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      )
    const send = async (event) => {
      await page.evaluate((event) => window.qa.send(event), event)
      await settle()
    }
    const mount = async (platform = 'darwin') => {
      await page.evaluate((platform) => {
        window.qa.platform = platform
        window.qa.mount()
      }, platform)
      await page.getByRole('button', { name: 'Get started', exact: true }).click()
      await settle()
      assert.deepEqual(await page.evaluate(() => window.qa.listeners()), [1, 1])
    }
    const resolve = async (result) => {
      await page.evaluate((result) => window.qa.resolve(result), result)
      await settle()
    }
    const terminal = async (text) => {
      await page.getByText(text, { exact: true }).waitFor()
      assert.equal(await page.locator('.wizard-loading').count(), 0)
      assert.equal(await page.locator('.wizard-progress').count(), 0)
      assert.equal(
        await page.getByRole('button', { name: 'Continue', exact: true }).isEnabled(),
        true
      )
      assert.equal(
        await page.evaluate(() =>
          document.getAnimations().some((a) => a.animationName === 'wizard-loading-pulse')
        ),
        false
      )
    }
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await mount()
    if (baseline) {
      await send({ stage: 'models' })
      assert.equal(await page.locator('.wizard-loading').count(), 0)
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0)
      await page.screenshot({ path: path.join(artifacts, 'baseline-static.png') })
      await page.evaluate(() => window.qa.reject())
      await settle()
      assert.equal(
        await page.getByRole('button', { name: 'Setting up…', exact: true }).isDisabled(),
        true
      )
      assert.deepEqual(errors, ['Synthetic IPC failure'])
      console.log(
        'BASELINE CONFIRMED: static loading; rejected preflight leaves setup disabled with an unhandled rejection'
      )
    } else {
      assert.equal(await page.getByRole('status').innerText(), 'Getting ready…')
      assert.equal(await page.locator('.wizard-loading > span').count(), 3)
      assert.equal(await page.locator('.wizard-loading').getAttribute('aria-hidden'), 'true')
      assert.equal(
        await page.getByRole('button', { name: 'Setting up…', exact: true }).isDisabled(),
        true
      )
      assert.equal(await page.locator('progress').count(), 0)
      await send({ stage: 'mic', granted: true })
      await send({ stage: 'screen', granted: true })
      await send({ stage: 'models' })
      assert.equal(await page.locator('.wizard-row .wz-ok').count(), 2)
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme
        }, theme)
        const frames = await page.evaluate(async () => {
          const samples = []
          for (let i = 0; i < 16; i++) {
            samples.push({
              opacity: [...document.querySelectorAll('.wizard-loading > span')].map(
                (n) => getComputedStyle(n).opacity
              ),
              bounds: [...document.querySelectorAll('.wizard-row, .wizard-cta')].map((n) => {
                const r = n.getBoundingClientRect()
                return [r.x, r.y, r.width, r.height]
              })
            })
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          return samples
        })
        assert.ok(
          new Set(frames.map((f) => JSON.stringify(f.opacity))).size > 8,
          'dots pulse without new events'
        )
        frames.forEach((f) =>
          assert.deepEqual(f.bounds, frames[0].bounds, 'animation cannot shift layout')
        )
        await page.screenshot({ path: path.join(artifacts, `preparing-${theme}.png`) })
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.deepEqual(
        await page
          .locator('.wizard-loading > span')
          .evaluateAll((nodes) =>
            nodes.map((n) => [getComputedStyle(n).animationName, getComputedStyle(n).opacity])
          ),
        [
          ['none', '1'],
          ['none', '1'],
          ['none', '1']
        ]
      )
      assert.equal(
        await page.getByRole('status').innerText(),
        'Preparing the transcription engine…'
      )
      const ax = await page.locator('.wizard-rows').ariaSnapshot()
      assert.match(ax, /status/)
      assert.match(ax, /Preparing the transcription engine/)
      fs.writeFileSync(path.join(artifacts, 'accessibility.txt'), ax)
      await page.screenshot({ path: path.join(artifacts, 'reduced-motion.png') })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await send({ stage: 'download', progress: 0.37 })
      assert.equal(
        await page
          .getByRole('progressbar', { name: 'Transcription model download' })
          .getAttribute('value'),
        '0.37'
      )
      assert.equal(await page.locator('.wizard-loading').count(), 1)
      await page.waitForTimeout(1300) // Record continuing activity during unchanged numeric progress.
      await send({ stage: 'ready' })
      await terminal('Transcription is ready')
      await page.screenshot({ path: path.join(artifacts, 'ready.png') })
      await resolve({ ok: true })
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByRole('heading', { name: 'Notes model', exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.qa.listeners()), [0, 1])
      for (const scenario of [
        'event-error',
        'failed-result',
        'timeout',
        'rejected',
        'result-ready'
      ]) {
        await mount()
        await send({ stage: 'download', progress: 0.5 })
        if (scenario === 'event-error')
          await send({ stage: 'error', message: 'Synthetic engine failure' })
        else if (scenario === 'rejected') {
          await page.evaluate(() => window.qa.reject())
          await settle()
        } else
          await resolve({
            ok: scenario === 'result-ready',
            error: scenario === 'timeout' ? 'setup timed out' : undefined
          })
        const text =
          scenario === 'event-error'
            ? 'Synthetic engine failure'
            : scenario === 'timeout'
              ? 'setup timed out'
              : scenario === 'result-ready'
                ? 'Transcription is ready'
                : 'Setup hit a snag — you can finish later from Settings'
        await terminal(text)
        if (scenario === 'timeout')
          await page.screenshot({ path: path.join(artifacts, 'timeout.png') })
      }
      await mount()
      await send({ stage: 'mic', granted: false })
      await send({ stage: 'screen', granted: false })
      await send({ stage: 'models' })
      assert.match(
        await page.locator('.wizard-hint').innerText(),
        /Grant it later in System Settings/
      )
      assert.equal(await page.locator('.wizard-row .wz-bad').count(), 2)
      const skipped = await page.evaluate(() => window.qa.attempts.length - 1)
      await page.getByRole('button', { name: 'Skip setup', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.getByText('Setup closed', { exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.qa.listeners()), [0, 0])
      assert.equal(await page.locator('.wizard-loading').count(), 0)
      await mount('win32')
      await page.evaluate(
        (index) => window.qa.resolve({ ok: false, error: 'Old skipped attempt' }, index),
        skipped
      )
      await settle()
      assert.equal(await page.getByRole('status').innerText(), 'Getting ready…')
      assert.equal(
        await page.getByRole('heading', { name: 'Transcription', exact: true }).count(),
        1
      )
      assert.equal(await page.getByText('Microphone access', { exact: true }).count(), 0)
      assert.equal(await page.getByText('System audio', { exact: true }).count(), 0)
      await send({ stage: 'models' })
      await page.screenshot({ path: path.join(artifacts, 'windows-fixture.png') })
      await resolve({ ok: true })
      await terminal('Transcription is ready')
      await page.waitForTimeout(500)
      assert.deepEqual(errors, [])
      console.log(
        'PASS: continuous animation and stable geometry; light/dark; reduced motion and status semantics; real numeric progress; ready/error/result/timeout/rejection; denial guidance; Skip/Enter and background completion; fresh sessions/listener cleanup; Windows renderer copy. Native Windows and VoiceOver require human QA.'
      )
    }
    const video = page.video()
    await context.close()
    await video.saveAs(
      path.join(artifacts, baseline ? 'baseline.webm' : 'transcription-setup.webm')
    )
    console.log('Evidence:', artifacts)
  } finally {
    await browser?.close()
    server.close()
    fs.rmSync(bundle, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
