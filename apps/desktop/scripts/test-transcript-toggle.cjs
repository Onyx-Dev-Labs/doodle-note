/* Synthetic renderer replay; never starts capture or changes OS permissions.
 * DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-transcript-toggle.cjs
 * Add --baseline to capture the original font arrows at the recorded base commit.
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
const output = mkdtempSync(join(tmpdir(), 'ony276-renderer-'))

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
      builder.onLoad({filter: /(?:MeetingView\.tsx|icons\.tsx|main\.css)$/}, args => ({
        contents: execFileSync('git', ['show', '68fbc7c0507c536ce04caed03dabf19f4935ede4:apps/desktop/src/renderer/src/' + require('node:path').relative(join(desktop,'src/renderer/src'),args.path)], {cwd: desktop, encoding:'utf8'}),
        loader: args.path.endsWith('.css') ? 'css' : 'tsx', resolveDir: require('node:path').dirname(args.path)
      }))
    }}] : [],
    bundle: true, format: 'iife', jsx: 'automatic', outfile: join(output, 'app.js'),
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' }
  })
  writeFileSync(join(output, 'index.html'), '<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script src="/app.js"></script></body></html>')
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
      window.qa = {starts:0,stops:0,send: event => listeners.forEach(cb => cb(event))}
      const meeting = {id:'qa',title:'Transcript arrow QA',rawNotesMarkdown:'Synthetic test content.',segments:[],participants:[],echoSuppressed:0}
      window.meetings = {get:async()=>meeting,upsert:async()=>meeting}
      window.engine = {
        onEvent:cb=>{listeners.add(cb);return()=>listeners.delete(cb)},listInputDevices:async()=>[],
        start:()=>{window.qa.starts++;window.qa.send({event:'started',command:'live',binaryPath:'synthetic'})},
        stop:()=>{window.qa.stops++;window.qa.send({event:'status',stage:'finishing'})},setInputDevice:()=>{}
      }
      window.notes = {onAskToken:noEvent,onEnhanceProgress:noEvent,models:async()=>({models:[],ramGB:16}),getSettings:async()=>({engineChoice:'local'}),templates:async()=>[]}
      window.audio = {list:async()=>[]}
      window.folders = {list:async()=>[]}
      window.detect = {getState:async()=>({platform:'darwin'}),onMeetingEnded:noEvent}
    })
    const send = async event => { await page.evaluate(event=>window.qa.send(event),event); await settle() }
    const settle = () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    for (const scale of [1, 1.25, 2]) {
      for (const theme of ['light','dark']) {
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        await page.getByTitle('Start recording',{exact:true}).waitFor()
        await page.evaluate(({scale,theme})=>{document.documentElement.dataset.theme=theme;document.body.style.zoom=scale;document.getElementById('root').style.height=(760/scale)+'px';document.getElementById('root').style.width=(1000/scale)+'px'},{scale,theme})
        await settle()
        const toggle=page.locator('.chev-btn')
        const bounds=()=>page.locator('.rec-pill, .chev-btn, .record-btn, .stop-btn').evaluateAll(nodes=>nodes.map(n=>{
          const r=n.getBoundingClientRect();return [n.className,r.x,r.y,r.width,r.height]
        }))
        async function pair(state) {
          const before=await bounds()
          for (const expanded of [false,true]) {
            if ((await toggle.getAttribute('title')) !== (expanded?'Hide transcript':'Show transcript')) await toggle.click()
            await settle()
            if (!baseline) {
              assert.equal(await toggle.getAttribute('aria-expanded'),String(expanded))
              assert.equal(await toggle.getAttribute('aria-label'),expanded?'Hide transcript':'Show transcript')
            }
            assert.equal(await page.locator('.transcript-panel').count(),expanded?1:0)
            assert.deepEqual(await bounds(),before,`${state}: toggle must preserve all control bounds`)
            // Keep the untouched hit target visible through native hover styling.
            await page.evaluate(()=>document.activeElement?.blur())
            await toggle.hover()
            await page.locator('.rec-pill').screenshot({path:join(output,`${theme}-${scale}-${state}-${expanded?'down':'up'}.png`)})
          }
          await toggle.click()
          if (!baseline) {
            await toggle.focus()
            await page.keyboard.press('Enter');await settle()
            assert.equal(await toggle.getAttribute('aria-expanded'),'true')
            await page.keyboard.press('Space');await settle()
            assert.equal(await toggle.getAttribute('aria-expanded'),'false')
            assert.deepEqual(await bounds(),before)
          }
        }
        await pair('idle')
        await page.getByTitle('Start recording',{exact:true}).click()
        await pair('startup')
        await send({event:'status',stage:'permission_granted',permission:'microphone'})
        const permissionStatus=await page.locator('.rec-timer').innerText()
        await pair('permission')
        assert.equal(await page.locator('.rec-timer').innerText(),permissionStatus)
        await send({event:'ready',channels:['mic','system']})
        assert.match(await page.locator('.rec-timer').innerText(),/^\d+:\d{2}$/)
        await pair('recording')
        await send({event:'segments',segments:[{id:'seg1',channel:'mic',speaker:'You',text:'Synthetic arrow alignment test.',startMs:0,endMs:1000}]})
        await page.getByRole('button',{name:'Stop recording',exact:true}).click()
        assert.equal(await page.getByRole('button',{name:'Stop recording',exact:true}).isDisabled(),true)
        await pair('finishing')
        await send({event:'done'})
        await page.getByTitle('Resume recording',{exact:true}).waitFor()
        await pair('resume')
        await page.getByTitle('Resume recording',{exact:true}).click()
        await send({event:'error',message:'Synthetic microphone access error.'})
        assert.match(await page.locator('body').innerText(),/Synthetic microphone access error/)
        await send({event:'exit',code:64,signal:null})
        assert.equal(await page.locator('.rec-timer').count(),0)
        await page.getByTitle('Resume recording',{exact:true}).waitFor()
        assert.deepEqual(await page.evaluate(()=>[window.qa.starts,window.qa.stops]),[2,1])
      }
    }
    assert.deepEqual(errors,[])
    console.log('PASS: six states, both arrows, light/dark, 100/125/200% zoom; stable bounds, click/Enter/Space, Record/Stop/Resume and error preservation')
  } finally { await browser.close(); server.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
