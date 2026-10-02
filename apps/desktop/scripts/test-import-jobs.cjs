// Synthetic Electron integration: actual IPC/store/UI; isolated profile and fake
// batch worker. Never captures audio or accesses the user's library.
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const desktop = path.resolve(__dirname, '..')
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doodle-import-ui-')))
const profile = path.join(temp, 'profile')
fs.mkdirSync(profile)
const fixture = path.join(temp, 'safe-fixture.wav')
fs.writeFileSync(fixture, Buffer.alloc(48))
const mainPath = path.join(desktop, 'out/main/index.js')
let source = fs.readFileSync(mainPath, 'utf8')
assert.ok(source.includes('const importService = new ImportService('))
source = source.replace('const importService = new ImportService(', 'const importService = global.testImporter = new ImportService(')
source = source.replace('const recording = new RecordingStartCoordinator(', 'const recording = global.testRecording = new RecordingStartCoordinator(')
source = source.replace('new EngineProcess(resolveEngineBinary())', 'global.mockEngine(new EngineProcess(resolveEngineBinary()))')
fs.writeFileSync(path.join(temp, 'source.cjs'), source)
fs.writeFileSync(path.join(temp, 'main.cjs'), `
const electron=require('electron');
electron.app.setAppPath(${JSON.stringify(desktop)});
electron.app.setPath('userData',${JSON.stringify(profile)});
electron.nativeTheme.themeSource='light';
electron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(fixture)}]});
const cp=require('node:child_process');const spawn=cp.spawn;
cp.spawn=(binary,args,options)=>binary.endsWith('/engine')?spawn(process.execPath,['-e','process.exit(0)'],{...options,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}):spawn(binary,args,options);
global.mockEngine=engine=>{engine.startServe=()=>{};engine.listInputDevices=async()=>[];return engine;};
const Module=require('node:module'); const mod=new Module(${JSON.stringify(mainPath)},module);
mod.filename=${JSON.stringify(mainPath)};mod.paths=Module._nodeModulePaths(${JSON.stringify(path.dirname(mainPath))});require.cache[mod.filename]=mod;
mod._compile(require('node:fs').readFileSync(${JSON.stringify(path.join(temp, 'source.cjs'))},'utf8'),mod.filename);
`)
let runtime
;(async()=>{
  try {
    runtime=await _electron.launch({executablePath:require(path.join(desktop,'node_modules/electron')),args:[path.join(temp,'main.cjs')],env:{...process.env,DOODLE_USER_DATA:profile,DOODLE_NOTE_MCP_CONFIG:path.join(temp,'mcp.json')}})
    let page
    for(let i=0;i<100;i++){page=runtime.windows().find(p=>p.url().includes('index.html'));if(page)break;await new Promise(r=>setTimeout(r,100))}
    assert.ok(page)
    await page.waitForFunction(()=>!!window.importer)
    await page.evaluate(()=>{localStorage.setItem('doodle-onboarding-done','1');localStorage.setItem('doodle-setup-wizard-done','1')})
    await page.reload()
    await runtime.evaluate(()=>{
      global.testImporter.platformTranscriber=(_file,onProgress,options)=>new Promise((resolve,reject)=>{
        onProgress({stage:'transcribing'});
        global.workerExit=()=>options.signal.aborted?reject(Object.assign(new Error('Canceled'),{name:'AbortError'})):resolve({audioSeconds:1,segments:[{id:'safe-segment',channel:'mic',speaker:'You',text:'Synthetic fixture transcript',startMs:0,endMs:1000,confidence:1}]});
      })
    })
    await page.evaluate(()=>{window.pendingImport=window.importer.importAudio()})
    await page.getByText('Transcribing recording…',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Settings',exact:true}).click()
    assert.ok(await page.getByText('Transcribing recording…',{exact:true}).isVisible())
    await page.getByRole('button',{name:'Hide details',exact:true}).click()
    assert.ok(await page.getByRole('button',{name:'Cancel import',exact:true}).isVisible())
    await page.reload()
    await page.getByText('Transcribing recording…',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Cancel import',exact:true}).click()
    await page.getByText('Canceling import…',{exact:true}).waitFor()
    assert.equal(await runtime.evaluate(()=>global.testImporter.isBusy),true)
    await runtime.evaluate(()=>global.workerExit())
    await page.getByText('Import canceled',{exact:true}).waitFor()
    assert.equal(await runtime.evaluate(()=>global.testImporter.isBusy),false)
    assert.equal((await page.evaluate(()=>window.meetings.list())).length,0)
    await page.getByRole('button',{name:'Retry',exact:true}).click()
    await page.getByText('Transcribing recording…',{exact:true}).waitFor()
    await runtime.evaluate(()=>global.workerExit())
    await page.getByText('Transcript ready',{exact:true}).waitFor()
    const state=await page.evaluate(()=>window.importer.getStatus())
    const record=await page.evaluate(id=>window.meetings.get(id),state.meetingId)
    assert.equal(record.segments[0].text,'Synthetic fixture transcript')
    // The completion action must reveal the transcript, including repeated
    // requests for a meeting whose editor is already mounted with it hidden.
    await page.getByRole('button',{name:'Open transcript',exact:true}).click()
    await page.getByText('Synthetic fixture transcript',{exact:true}).waitFor({timeout:5000})
    await page.getByRole('button',{name:'Hide transcript',exact:true}).click()
    await page.getByRole('button',{name:'Open transcript',exact:true}).click()
    await page.getByText('Synthetic fixture transcript',{exact:true}).waitFor({timeout:5000})
    await page.getByRole('button',{name:'Hide transcript',exact:true}).click()
    await page.getByRole('button',{name:'Back to home',exact:true}).click()
    await page.getByRole('button',{name:'Open transcript',exact:true}).click()
    await page.getByText('Synthetic fixture transcript',{exact:true}).waitFor({timeout:5000})
    // Failed/canceled rebuild preserves transcript and notes, including parts.
    await page.evaluate(id=>window.meetings.upsert({id,rawNotesMarkdown:'Keep fixture notes'}),state.meetingId)
    await runtime.evaluate(()=>{global.testImporter.audio.listPaths=()=>[{path:'first.wav',startEpochMs:1000},{path:'second.wav',startEpochMs:2000}];let count=0;global.testImporter.platformTranscriber=async()=>{if(++count===2)throw new Error('Synthetic corrupt part');return{audioSeconds:1,segments:[{id:'replacement',channel:'mic',speaker:'You',text:'Replacement must not persist',startMs:0,endMs:1000,confidence:1}]}}})
    const result=await page.evaluate(id=>window.importer.retranscribe(id),state.meetingId)
    assert.match(result.error,/part 2 of 2/)
    const retained=await page.evaluate(id=>window.meetings.get(id),state.meetingId)
    assert.equal(retained.segments[0].text,'Synthetic fixture transcript')
    assert.equal(retained.rawNotesMarkdown,'Keep fixture notes')
    await page.getByText('Import needs attention',{exact:true}).waitFor()
    await page.screenshot({path:path.join(temp,'import-failure-preserved.png')})
    await runtime.evaluate((_,id)=>{global.testRecording.state={phase:'recording',eligible:false,meetingId:id};global.testRecording.engineClaimed=true},state.meetingId)
    const blocked=await page.evaluate(id=>window.importer.retranscribe(id),state.meetingId)
    assert.match(blocked.error,/Stop recording/)
    await runtime.evaluate(()=>global.testRecording.handle({event:'exit',code:0}))
    await runtime.evaluate(()=>{global.testImporter.audio.listPaths=()=>[{path:'first.wav',startEpochMs:1000}];global.testImporter.platformTranscriber=()=>new Promise(resolve=>{global.finishRebuild=()=>resolve({audioSeconds:1,segments:[{id:'new',channel:'mic',speaker:'You',text:'Replacement',startMs:0,endMs:1000,confidence:1}]})})})
    await page.evaluate(id=>{window.pendingRebuild=window.importer.retranscribe(id)},state.meetingId)
    await page.waitForFunction(async()=>['starting','transcribing'].includes((await window.importer.getStatus()).stage))
    await page.evaluate(id=>window.engine.start('live',undefined,{meetingId:id}),state.meetingId)
    await page.evaluate(()=>window.importer.getStatus())
    assert.equal(await runtime.evaluate(()=>global.testRecording.busy),false)
    await page.evaluate(id=>window.meetings.upsert({id,trashedAt:new Date().toISOString()}),state.meetingId)
    await runtime.evaluate(()=>global.finishRebuild())
    assert.match((await page.evaluate(()=>window.pendingRebuild)).error,/Trash/)
    assert.equal((await page.evaluate(id=>window.meetings.get(id),state.meetingId)).segments[0].text,'Synthetic fixture transcript')
    await page.evaluate(id=>window.meetings.upsert({id,trashedAt:null}),state.meetingId)
    await page.evaluate(id=>{window.pendingRebuild=window.importer.retranscribe(id)},state.meetingId)
    await page.waitForFunction(async()=>['starting','transcribing'].includes((await window.importer.getStatus()).stage))
    await page.evaluate(id=>window.meetings.delete(id),state.meetingId)
    await runtime.evaluate(()=>global.finishRebuild())
    assert.match((await page.evaluate(()=>window.pendingRebuild)).error,/deleted/)
    assert.equal(await page.evaluate(id=>window.meetings.get(id),state.meetingId),null)

    console.log(JSON.stringify({passed:true,profile,checks:['persistent navigation status','reload snapshot','cancel waits for worker exit','no canceled meeting','retry commits once','open completed transcript from another view and repeatedly after hiding','multipart failure preserves transcript and notes','capture exclusion both directions','trash and deletion cannot resurrect transcript']}))
  } catch(error) {
    console.error(error)
    process.exitCode=1
  } finally {
    if(runtime){
      // Windows Electron can retain its tray/launcher after the test closes
      // the window. Terminate only this harness's isolated child process tree.
      if(process.platform==='win32'){
        require('node:child_process').execFileSync('taskkill',['/pid',String(runtime.process().pid),'/T','/F'],{stdio:'ignore'})
      } else await runtime.close()
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1})
