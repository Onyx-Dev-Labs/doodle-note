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
const output = mkdtempSync(join(tmpdir(), 'dev362-renderer-'))

async function main() {
  console.log('Renderer QA artifacts:', output, baseline ? '(baseline)' : '(fixed)')
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import MeetingView from './MeetingView'; import './assets/main.css'; import {flushLibrarySaves} from './lib/library-flush'; window.qaFlushLibrary=flushLibrarySaves;
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
      window.qa = {starts:0,stops:0,snapshot:null,saves:[],parts:[],send: event => listeners.forEach(cb => cb(event))}
      const meeting = window.qa.meeting = {id:'qa',title:'Transcript arrow QA',rawNotesMarkdown:'Synthetic test content.',segments:[],participants:[],echoSuppressed:0}
      window.meetings = {get:async()=>meeting,upsert:async patch=>{Object.assign(meeting,patch);window.qa.saves.push(patch);return meeting}}
      window.engine = {
        snapshot:async()=>window.qa.snapshot,onEvent:cb=>{listeners.add(cb);return()=>listeners.delete(cb)},listInputDevices:async()=>[],
        start:()=>{window.qa.starts++;window.qa.send({event:'started',command:'live',binaryPath:'synthetic'})},
        stop:()=>{window.qa.stops++;window.qa.send({event:'status',stage:'finishing'})},setInputDevice:()=>{}
      }
      window.notes = {onAskToken:noEvent,onEnhanceProgress:noEvent,models:async()=>({models:[],ramGB:16}),getSettings:async()=>({engineChoice:'local'}),templates:async()=>[]}
      window.audio = {list:async()=>window.qa.parts,read:async()=>null}
      const progressListeners=new Set()
      window.importer = {onProgress:cb=>{progressListeners.add(cb);return()=>progressListeners.delete(cb)},retranscribe:async()=>{meeting.segments=[{id:'batch-replacement',channel:'mic',speaker:'You',text:'Only the rebuilt transcript remains.',startMs:0,endMs:1000,confidence:1}];return {id:'qa'}}}
      window.qa.refreshImported=()=>progressListeners.forEach(cb=>cb({meetingId:'qa',stage:'completed'}))
      window.qa.completeBackground=(meetingId='qa',stage='completed')=>{meeting.segments=[{id:'retry-result',channel:'mic',speaker:'You',text:'Background retry replaced the transcript.',startMs:0,endMs:1000,confidence:1}];progressListeners.forEach(cb=>cb({meetingId,stage}))}

      Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.qa.clipboard=text}}})
      window.folders = {list:async()=>[]}
      window.detect = {getState:async()=>({platform:'darwin'}),onMeetingEnded:noEvent}
    })
    const send = async event => { await page.evaluate(event=>window.qa.send(event),event); await settle() }
    const settle = () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByTitle('Start recording',{exact:true}).click()
    await send({event:'ready',channels:['mic','system']})
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
    assert.equal(await page.evaluate(()=>window.qa.saves.some(s=>'segments' in s || 'echoSuppressed' in s)),false)
    await page.evaluate(()=>{window.qa.parts=[{url:'synthetic-recording',startEpochMs:1000,durationMs:1000}];window.qa.send({event:'audio'})})
    page.once('dialog',dialog=>dialog.accept())
    await page.getByRole('button',{name:'Re-transcribe',exact:true}).click()
    await page.getByText('Only the rebuilt transcript remains.',{exact:true}).waitFor()
    assert.equal(await page.getByText('Synthetic hidden capture survives.',{exact:true}).count(),0)
    assert.equal(await page.getByText('Recovered from main checkpoint.',{exact:true}).count(),0)
    await page.evaluate(()=>window.qa.completeBackground('different-meeting'))
    await settle()
    assert.equal(await page.getByText('Only the rebuilt transcript remains.',{exact:true}).count(),1)
    await page.evaluate(()=>window.qa.completeBackground('qa','failed'))
    await settle()
    assert.equal(await page.getByText('Only the rebuilt transcript remains.',{exact:true}).count(),1)
    await page.evaluate(()=>window.qa.completeBackground())
    await page.getByText('Background retry replaced the transcript.',{exact:true}).waitFor()
    assert.equal(await page.getByText('Only the rebuilt transcript remains.',{exact:true}).count(),0)
    await page.evaluate(()=>window.qaFlushLibrary())
    assert.equal(await page.evaluate(()=>window.qa.saves.some(s=>'segments' in s || 'echoSuppressed' in s)),false)
    // Legacy recordings reused seg_N in each session/part. Replay both native-QA
    // counts with synthetic text; never use the real captured transcript here.
    for (const [firstCount, secondCount] of [[5,8],[3,4]]) {
      await page.evaluate(({firstCount,secondCount})=>{
        const part=(count,epoch,label)=>Array.from({length:count},(_,i)=>({
          id:'seg_'+(i+1),channel:'mic',speaker:'You',text:label+' synthetic line '+(i+1),
          startMs:i*2000,endMs:i*2000+1000,absoluteStartMs:epoch+i*2000,confidence:1
        }));
        window.qa.meeting.segments=[...part(firstCount,100000,'First'),...part(secondCount,200000,'Second')];
        window.qa.snapshot=null;
        window.qa.parts=[{url:'first-part',startEpochMs:100000,durationMs:30000},{url:'second-part',startEpochMs:200000,durationMs:30000}];
        window.qa.send({event:'audio'});
        // Invoke the existing matching-completion refresh without changing data.
        window.qa.refreshImported();
      },{firstCount,secondCount});
      await page.getByText('First synthetic line 1',{exact:true}).waitFor();
      assert.equal(await page.locator('.tp-row:not(.tp-partial)').count(),firstCount+secondCount);
      // A snapshot of the latest part must not duplicate it or hide the first.
      await page.evaluate(()=>{window.qa.snapshot={meetingId:'qa',phase:'ended',segments:window.qa.meeting.segments.filter(s=>s.absoluteStartMs>=200000),partials:{}}});
      await page.getByRole('button',{name:'Minimize transcript'}).click();
      await page.getByRole('button',{name:'Show transcript',exact:true}).click();
      await settle();
      assert.equal(await page.locator('.tp-row:not(.tp-partial)').count(),firstCount+secondCount);
      await page.getByTitle('Copy transcript',{exact:true}).click();
      const copied=await page.evaluate(()=>window.qa.clipboard);
      assert.equal(copied.split('\n').length,firstCount+secondCount);
      assert.match(copied,/First synthetic line 1/);
      assert.match(copied,new RegExp('Second synthetic line '+secondCount));
      for (const [index,label] of [['0','First'],['1','Second']]) {
        await page.getByRole('combobox',{name:'Recording part'}).selectOption(index);
        await page.evaluate(()=>{
          const audio=document.querySelector('.tp-audio audio');
          Object.defineProperty(audio,'paused',{configurable:true,get:()=>false});
          audio.currentTime=0.5;
          audio.dispatchEvent(new Event('timeupdate',{bubbles:true}));
        });
        await settle();
        assert.equal(await page.locator('.tp-playing').count(),1);
        assert.match(await page.locator('.tp-playing').innerText(),new RegExp(label+' synthetic line 1'));
      }
    }
    // Recover the completed latest part, Resume, Stop, and recover it again.
    // Promotion must merge raw copies, never append them or recycle view IDs.
    for (let cycle=0;cycle<2;cycle++) {
      await page.getByTitle('Resume recording',{exact:true}).click();
      await send({event:'ready',channels:['mic']});
      assert.equal(await page.locator('.tp-row:not(.tp-partial)').count(),7,'Resume after recovery preserves exactly seven legacy rows');
      await page.getByRole('button',{name:'Stop recording',exact:true}).click();
      await send({event:'done'});
      await send({event:'capture-finalized'});
      await page.getByRole('button',{name:'Show transcript',exact:true}).click();
      await settle();
      assert.equal(await page.locator('.tp-row:not(.tp-partial)').count(),7);
      await page.getByTitle('Copy transcript',{exact:true}).click();
      assert.equal((await page.evaluate(()=>window.qa.clipboard)).split('\n').length,7);
    }
    // Imported audio uses file-relative timing; Resume uses wall-clock timing.
    // Joining those domains must not render epoch-sized elapsed timestamps.
    await page.evaluate(()=>{
      window.qa.snapshot=null;
      window.qa.meeting.segments=[
        {id:'imported',channel:'mic',speaker:'Speaker',speakerId:'imported-speaker',text:'Imported synthetic phrase.',startMs:0,endMs:10000,confidence:1},
        {id:'resumed',channel:'system',speaker:'Them',text:'Resumed synthetic phrase.',startMs:3000,endMs:6000,absoluteStartMs:1790979993000,confidence:1}
      ];
      window.qa.parts=[{url:'imported-part',startEpochMs:1790979921059,durationMs:12000},{url:'resumed-part',startEpochMs:1790979990000,durationMs:40000}];
      window.qa.send({event:'audio'});
      window.qa.refreshImported();
    });
    await page.getByText('Imported synthetic phrase.',{exact:true}).waitFor();
    await settle();
    // No real audio decoder in this renderer harness; assert the actual part
    // selection that feeds the player (native QA checks playable fixtures).
    await page.evaluate(()=>{HTMLMediaElement.prototype.play=()=>Promise.resolve()});
    await page.getByText('Resumed synthetic phrase.',{exact:true}).click();
    assert.equal(await page.getByRole('combobox',{name:'Recording part'}).inputValue(),'1');
    await page.evaluate(()=>{
      const audio=document.querySelector('.tp-audio audio');
      Object.defineProperty(audio,'paused',{configurable:true,get:()=>false});
      audio.currentTime=0.5;audio.dispatchEvent(new Event('timeupdate',{bubbles:true}));
    });
    await settle();
    assert.equal(await page.locator('.tp-playing').count(),0,'recorded part must not highlight an imported row');
    await page.getByText('Imported synthetic phrase.',{exact:true}).click();
    assert.equal(await page.getByRole('combobox',{name:'Recording part'}).inputValue(),'0','imported row seeks the imported part after Resume');
    assert.deepEqual(await page.locator('.tp-row .tp-time').allTextContents(),['0:00','0:15'],'import/Resume timestamps use the saved audio timeline');
    await page.screenshot({path:join(output,'transcript-recovered.png')})
    assert.deepEqual(errors,[])
    console.log('PASS: hidden partial/final events, missed-event snapshot recovery, no duplicate segments, main-owned persistence, matching background completion, library flush, Resume, legacy 13/8 and 7/4 rows, Copy, part highlighting, imported/recorded timestamps and part selection')
  } finally { await browser.close(); server.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
