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
const output = mkdtempSync(join(tmpdir(), 'dev366-renderer-'))

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
      window.qa = {starts:0,stops:0,snapshot:null,saves:[],parts:[],reads:[],send: event => listeners.forEach(cb => cb(event))}
      const meeting = {id:'qa',title:'Transcript arrow QA',rawNotesMarkdown:'Synthetic test content.',segments:[],participants:[],echoSuppressed:0}
      window.meetings = {get:async()=>meeting,upsert:async patch=>{Object.assign(meeting,patch);window.qa.saves.push(patch);return meeting}}
      window.engine = {
        snapshot:async()=>window.qa.snapshot,onEvent:cb=>{listeners.add(cb);return()=>listeners.delete(cb)},listInputDevices:async()=>[],
        start:()=>{window.qa.starts++;window.qa.send({event:'started',command:'live',binaryPath:'synthetic'})},
        stop:()=>{window.qa.stops++;window.qa.send({event:'status',stage:'finishing'})},setInputDevice:()=>{}
      }
      window.notes = {onAskToken:noEvent,onEnhanceProgress:noEvent,models:async()=>({models:[],ramGB:16}),getSettings:async()=>({engineChoice:'local'}),templates:async()=>[]}
      window.audio = {list:async()=>window.qa.parts,read:async url=>{window.qa.reads.push(url);return null}}
      window.folders = {list:async()=>[]}
      window.detect = {getState:async()=>({platform:'darwin'}),onMeetingEnded:noEvent}
    })
    const send = async event => { await page.evaluate(event=>window.qa.send(event),event); await settle() }
    const settle = () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByTitle('Start recording',{exact:true}).click()
    await send({event:'ready',channels:['mic','system']})
    for (const [width,height,orientation] of [[1180,760,'vertical'],[580,560,'horizontal']]) {
      await page.setViewportSize({width,height})
      await settle()
      const divider=page.getByRole('separator',{name:'Resize notes and transcript'})
      assert.equal(await divider.getAttribute('aria-orientation'),orientation)
      const geometry=await page.evaluate(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
        return {notes:rect('.editor-scroll'),transcript:rect('.meeting-split > .transcript-panel'),stop:rect('.stop-btn')}
      })
      if (orientation==='vertical') assert.ok(geometry.notes.right<=geometry.transcript.x)
      else assert.ok(geometry.notes.bottom<=geometry.transcript.y)
      assert.ok(geometry.transcript.bottom<=geometry.stop.y)
      assert.ok(geometry.notes.width>=280 && geometry.notes.height>=120)
      assert.ok(geometry.transcript.width>=250 && geometry.transcript.height>=145)
      await divider.focus()
      const before=Number(await divider.getAttribute('aria-valuenow'))
      await page.keyboard.press(orientation==='vertical'?'ArrowRight':'ArrowDown')
      assert.ok(Number(await divider.getAttribute('aria-valuenow'))>before)
      await page.keyboard.press('Home')
      assert.equal(await divider.getAttribute('aria-valuenow'),await divider.getAttribute('aria-valuemin'))
      await page.keyboard.press('End')
      assert.equal(await divider.getAttribute('aria-valuenow'),await divider.getAttribute('aria-valuemax'))
      const box=await divider.boundingBox()
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
      await page.mouse.down()
      await page.mouse.move(orientation==='vertical'?width/2:box.x+box.width/2,orientation==='horizontal'?height/2:box.y+box.height/2)
      await page.mouse.up()
      const pointerValue=Number(await divider.getAttribute('aria-valuenow'))
      assert.ok(pointerValue>=Number(await divider.getAttribute('aria-valuemin')) && pointerValue<=Number(await divider.getAttribute('aria-valuemax')))
      await page.locator('.tiptap').fill('Synthetic editable notes while capture continues.')
      assert.match(await page.locator('.tiptap').innerText(),/editable notes/)
      await page.screenshot({path:join(output,`split-${orientation}.png`)})
    }
    const remembered=await page.evaluate(()=>localStorage.getItem('doodle.transcriptPaneSize'))
    await page.getByRole('button',{name:'Minimize transcript'}).click()
    await page.getByRole('button',{name:'Show transcript',exact:true}).click()
    assert.equal(await page.evaluate(()=>localStorage.getItem('doodle.transcriptPaneSize')),remembered)
    await page.getByRole('button',{name:'Minimize transcript'}).click()
    const segment={id:'hidden1',channel:'mic',speaker:'You',text:'Synthetic hidden capture survives.',startMs:0,endMs:1000,confidence:1}
    await send({event:'partial',channel:'mic',text:'Synthetic partial while hidden'})
    await send({event:'segments',segments:[segment]})
    assert.equal(await page.locator('.transcript-panel').count(),0)
    await page.getByRole('button',{name:'Show transcript',exact:true}).click()
    assert.match(await page.locator('.tp-body').innerText(),/Synthetic hidden capture survives/)
    await page.getByRole('button',{name:'Minimize transcript'}).click()
    // Simulate a missed IPC delivery, then main's authoritative recovery on reveal.
    await page.evaluate(segment=>{window.qa.snapshot={meetingId:'qa',phase:'recording',segments:[segment,{...segment,id:'hidden2',text:'Recovered from main checkpoint.'}],partials:{}}},segment)
    await page.getByRole('button',{name:'Show transcript',exact:true}).click()
    await page.getByText('Recovered from main checkpoint.',{exact:true}).waitFor()
    assert.equal(await page.getByText('Synthetic hidden capture survives.',{exact:true}).count(),1)
    await page.getByRole('button',{name:'Stop recording',exact:true}).click()
    await page.evaluate(()=>{window.qa.snapshot=null})
    await send({event:'done'})
    await send({event:'capture-finalized'})
    await page.getByTitle('Resume recording',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Show transcript',exact:true}).click()
    assert.equal(await page.getByText('Recovered from main checkpoint.',{exact:true}).count(),1)
    assert.equal(await page.evaluate(()=>window.qa.saves.some(s=>s.segments?.some(x=>x.id==='hidden2'))),true)
    await page.screenshot({path:join(output,'transcript-recovered.png')})
    await page.evaluate(()=>{window.qa.parts=[{url:'synthetic-part-1',startEpochMs:1000,durationMs:1000},{url:'synthetic-part-2',startEpochMs:2000,durationMs:1000}];window.qa.send({event:'audio'})})
    await page.getByRole('combobox',{name:'Recording part'}).selectOption('1')
    await settle()
    assert.ok(await page.evaluate(()=>window.qa.reads.includes('synthetic-part-2')))
    const savedSize=await page.evaluate(()=>localStorage.getItem('doodle.transcriptPaneSize'))
    await page.reload()
    await page.getByRole('button',{name:'Show transcript',exact:true}).click()
    assert.equal(await page.evaluate(()=>localStorage.getItem('doodle.transcriptPaneSize')),savedSize)
    await page.evaluate(()=>document.documentElement.dataset.theme='dark')
    await page.screenshot({path:join(output,'split-dark-restored.png')})
    assert.deepEqual(errors,[])
    console.log('PASS: wide/narrow docked geometry, keyboard and pointer resize, remembered size, editable notes, hidden capture continuity and terminal persistence')
  } finally { await browser.close(); server.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
