/* Synthetic renderer replay; never starts capture or changes OS permissions.
 * DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-capture-permission-status.cjs
 * Add --baseline to demonstrate the old misleading statuses from origin/main.
 */
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { createServer } = require('node:http')
const desktop = resolve(__dirname, '..')
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite', { paths: [desktop] })] }))
const { chromium } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const baseline = process.argv.includes('--baseline')
const output = mkdtempSync(join(tmpdir(), 'ony275-renderer-'))

async function main() {
  console.log('Renderer QA artifacts:', output, baseline ? '(baseline)' : '(fixed)')
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import MeetingView from './MeetingView'; import './assets/main.css';
        createRoot(document.getElementById('root')).render(<MeetingView meetingId="qa" visible={true}
          autoRecord={false} isNewDraft={false} onAutoRecordStarted={()=>{}} onDraftSettled={()=>{}}
          onDiscardDraft={async()=>{}} onBack={()=>{}} onOpenSettings={()=>{}}/>);`,
      resolveDir: join(desktop, 'src/renderer/src'), loader: 'tsx'
    },
    plugins: baseline ? [{ name: 'baseline', setup(builder) {
      builder.onLoad({filter: /MeetingView\.tsx$/}, args => ({
        contents: execFileSync('git', ['show', 'origin/main:apps/desktop/src/renderer/src/MeetingView.tsx'], {cwd: desktop, encoding:'utf8'}),
        loader: 'tsx', resolveDir: require('node:path').dirname(args.path)
      }))
    }}] : [],
    bundle: true, format: 'iife', jsx: 'automatic', outfile: join(output, 'app.js'),
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' }
  })
  writeFileSync(join(output, 'index.html'), '<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root" style="height:100vh"></div><script src="/app.js"></script></body></html>')
  const server = createServer((req, res) => {
    const name = req.url === '/app.js' ? 'app.js' : req.url === '/app.css' ? 'app.css' : 'index.html'
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html')
    res.end(readFileSync(join(output, name)))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({channel:'chrome', headless:true})
  try {
    const page = await browser.newPage({viewport:{width:1000,height:760}})
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      const listeners = new Set()
      const noEvent = () => () => {}
      window.qa = {send: event => listeners.forEach(cb => cb(event))}
      const meeting = {id:'qa',title:'Permission startup QA',rawNotesMarkdown:'Synthetic test content.',segments:[],participants:[],echoSuppressed:0}
      window.meetings = {get:async()=>meeting,upsert:async()=>meeting}
      window.engine = {
        onEvent:cb=>{listeners.add(cb);return()=>listeners.delete(cb)},listInputDevices:async()=>[],
        start:()=>window.qa.send({event:'started',command:'live',binaryPath:'synthetic'}),
        stop:()=>window.qa.send({event:'status',stage:'finishing'}),setInputDevice:()=>{}
      }
      window.notes = {onAskToken:noEvent,onEnhanceProgress:noEvent,models:async()=>({models:[],ramGB:16}),getSettings:async()=>({engineChoice:'local'}),templates:async()=>[]}
      window.audio = {list:async()=>[]}
      window.folders = {list:async()=>[]}
      window.detect = {getState:async()=>({platform:'darwin'}),onMeetingEnded:noEvent}
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByTitle('Start recording',{exact:true}).waitFor()
    const send = async event => { await page.evaluate(event=>window.qa.send(event),event); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))) }
    const status = page.locator('.rec-timer')
    const screenshot = name => page.screenshot({path:join(output,name+'.png')})
    await page.getByTitle('Start recording',{exact:true}).click()
    if (baseline) {
      await send({event:'status',stage:'requesting_permission',permission:'microphone'})
      assert.match(await status.innerText(),/Waiting for macOS permission/)
      await screenshot('before-waiting')
      await send({event:'status',stage:'permission_granted',permission:'microphone'})
      assert.equal(await status.innerText(),'permission granted')
      await screenshot('before-granted')
      console.log('PASS: reproduced both misleading messages in the actual baseline recorder')
      return
    }
    for (let n=0;n<3;n++) {
      if (n) await page.getByTitle('Resume recording',{exact:true}).click()
      for (const stage of ['starting_capture','permission_granted','system_backend']) {
        await send({event:'status',stage})
        assert.equal(await status.innerText(),'Starting…')
        assert.doesNotMatch(await page.locator('body').innerText(), /your audio is being captured/)
      }
      if (!n) await screenshot('authorized-start')
      await send({event:'ready',channels:['mic','system']})
      assert.match(await status.innerText(),/^\d+:\d{2}$/)
      if (!n) await screenshot('recording')
      await send({event:'segments',segments:[{id:'seg'+n,channel:'mic',speaker:'You',text:'Synthetic permission test.',startMs:n*1000,endMs:(n+1)*1000}]})
      await page.getByRole('button',{name:'Stop recording',exact:true}).click()
      assert.equal(await status.innerText(),'Finishing up…')
      await send({event:'status',stage:'permission_granted'})
      assert.equal(await status.innerText(),'Finishing up…')
      await send({event:'done'})
    }
    await page.getByTitle('Resume recording',{exact:true}).click()
    await send({event:'status',stage:'requesting_permission',permission:'microphone'})
    assert.equal(await status.innerText(),'Allow microphone access to start recording…')
    await screenshot('first-use')
    await send({event:'error',message:'Microphone permission denied. Open System Settings → Privacy & Security → Microphone.'})
    await send({event:'exit',code:64,signal:null})
    assert.match(await page.locator('body').innerText(),/Microphone permission denied/)
    assert.equal(await page.locator('.rec-timer').count(),0)
    await screenshot('denied')
    await page.setViewportSize({width:800,height:560})
    await page.getByTitle('Resume recording',{exact:true}).click()
    await send({event:'status',stage:'serve_loading_models'})
    assert.equal(await status.innerText(),'Preparing transcription…')
    await screenshot('compact-loading')
    assert.deepEqual(errors,[])
    console.log('PASS: authorized repeat/Resume, readiness, stop, first-use, denied+exit recovery, compact model loading')
  } finally { await browser.close(); server.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
