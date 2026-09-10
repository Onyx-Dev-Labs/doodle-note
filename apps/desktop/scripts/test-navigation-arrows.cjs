/* Synthetic renderer replay; never starts capture or changes OS permissions.
 * DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-navigation-arrows.cjs
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
const output = mkdtempSync(join(tmpdir(), 'ony276-navigation-'))

async function main() {
  console.log('Renderer QA artifacts:', output, baseline ? '(baseline)' : '(fixed)')
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import MeetingView from './MeetingView'; import HomeView from './HomeView'; import './assets/main.css';
        const root=createRoot(document.getElementById('root'));
        window.showMeeting=()=>root.render(<MeetingView key="meeting" meetingId="qa" visible={true}
          autoRecord={false} isNewDraft={false} onAutoRecordStarted={()=>{}} onDraftSettled={()=>{}}
          onDiscardDraft={async()=>{}} onBack={()=>{window.qa.backs++;window.showHome()}} onOpenSettings={()=>{}}/>);
        window.showHome=()=>root.render(<HomeView key="home" meetings={[]} folders={[]} filter={{kind:'all'}}
          search="" calendar={null} onStartCalendarMeeting={()=>{}} onOpenMeeting={()=>{}}
          onNewMeeting={()=>window.qa.newMeetings++} onNewNote={()=>window.qa.newNotes++}
          onChanged={()=>{}} onOpenSettings={()=>{}}/>);
        window.showHome();`,
      resolveDir: join(desktop, 'src/renderer/src'), loader: 'tsx'
    },
    plugins: baseline ? [{ name: 'baseline', setup(builder) {
      builder.onLoad({filter: /(?:MeetingView\.tsx|HomeView\.tsx|icons\.tsx|main\.css)$/}, args => ({
        contents: execFileSync('git', ['show', '0c4b45331483d21a7e5c1c48e127a3802b7182fe:apps/desktop/src/renderer/src/' + require('node:path').relative(join(desktop,'src/renderer/src'),args.path)], {cwd: desktop, encoding:'utf8'}),
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
      window.qa = {starts:0,stops:0,backs:0,newMeetings:0,newNotes:0,templates:[],send: event => listeners.forEach(cb => cb(event))}
      const meeting = {id:'qa',title:'Transcript arrow QA',rawNotesMarkdown:'Synthetic test content.',segments:[{id:'s',channel:'mic',text:'Synthetic test.',startMs:0,endMs:1000}],participants:[],echoSuppressed:0}
      window.meetings = {get:async()=>meeting,upsert:async()=>meeting}
      window.engine = {
        onEvent:cb=>{listeners.add(cb);return()=>listeners.delete(cb)},listInputDevices:async()=>[],
        start:()=>{window.qa.starts++;window.qa.send({event:'started',command:'live',binaryPath:'synthetic'})},
        stop:()=>{window.qa.stops++;window.qa.send({event:'status',stage:'finishing'})},setInputDevice:()=>{}
      }
      window.notes = {onAskToken:noEvent,onEnhanceProgress:noEvent,models:async()=>({models:[{id:'qa',downloaded:true,active:true}],ramGB:16}),getSettings:async()=>({engineChoice:'local',autoGenerateNotesAfterStop:false}),getGlobalChat:async()=>[],onGlobalAskToken:noEvent,templates:async()=>[{id:'qa',label:'Test template',description:'Synthetic'}],enhance:async args=>{window.qa.templates.push(args.templateId);return {error:'Synthetic provider unavailable'}}}
      window.audio = {list:async()=>[]}
      window.folders = {list:async()=>[]}
      window.detect = {getState:async()=>({platform:'darwin'}),onMeetingEnded:noEvent}
    })
    const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    for(const theme of ['light','dark'])for(const scale of [1,1.25,2]) {
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.body.style.zoom=scale;
        document.getElementById('root').style.height=(760/scale)+'px';document.getElementById('root').style.width=(1000/scale)+'px'}, {theme,scale})
      const shot=async(name,locator)=>{await page.evaluate(()=>document.activeElement?.blur());await locator.screenshot({path:join(output,`${theme}-${scale}-${name}.png`)})}
      const newButton=page.getByRole('button',{name:'+ New',exact:true})
      await newButton.waitFor();await settle()
      await shot('new',newButton)
      const newBounds=await newButton.boundingBox()
      await newButton.click();assert.equal(await newButton.getAttribute('aria-expanded'),'true')
      await page.getByRole('menu',{name:'Create or import'}).waitFor()
      assert.deepEqual(await newButton.boundingBox(),newBounds)
      await page.keyboard.press('Escape');assert.equal(await newButton.getAttribute('aria-expanded'),'false')
      await newButton.focus();await page.keyboard.press('Enter')
      await page.getByRole('menuitem',{name:/New note/}).click()
      assert.equal(await page.evaluate(()=>window.qa.newNotes),1)
      await newButton.click();await page.getByRole('menuitem',{name:/New meeting/}).click()
      assert.equal(await page.evaluate(()=>window.qa.newMeetings),1)
      await page.evaluate(()=>window.showMeeting())
      const template=page.locator('.generate-cta-arrow');await template.waitFor();await settle()
      const back=baseline ? page.getByTitle('Back to home',{exact:true}) : page.getByRole('button',{name:'Back to home',exact:true})
      await shot('back',back);await shot('template',page.locator('.generate-cta-arrow').locator('..'))
      const box=await template.boundingBox()
      await template.click();assert.equal(await template.getAttribute('aria-expanded'),'true')
      await page.getByRole('menu',{name:'Note templates'}).waitFor()
      assert.deepEqual(await template.boundingBox(),box)
      await template.click();assert.equal(await template.getAttribute('aria-expanded'),'false')
      await template.focus();await page.keyboard.press('Space')
      await page.getByRole('menuitemradio',{name:/Test template/}).click()
      await page.waitForFunction(()=>window.qa.templates.length===1)
      assert.deepEqual(await page.evaluate(()=>window.qa.templates),['qa'])
      await back.focus();await page.keyboard.press('Enter')
      await newButton.waitFor();assert.equal(await page.evaluate(()=>window.qa.backs),1)
      assert.equal(await page.evaluate(()=>window.qa.starts),0)
    }
    assert.deepEqual(errors,[])
    console.log('PASS: New menu pointer/keyboard/Escape and actions; template toggle/selection; keyboard Back; two themes and three zooms; no capture')
  } finally { await browser.close(); server.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
