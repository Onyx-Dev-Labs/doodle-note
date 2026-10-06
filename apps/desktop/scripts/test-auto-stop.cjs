// Real main/preload/store integration with a synthetic engine and detector.
// No microphone, network account, model download or existing profile access.
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const desktop = path.resolve(__dirname, '..')
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doodle-auto-stop-')))
const profile = path.join(temp, 'profile')
fs.mkdirSync(profile)
const mainPath = path.join(desktop, 'out/main/index.js')
let source = fs.readFileSync(mainPath, 'utf8')
for (const [from, to] of [
  ['new WinEngineHost(broadcast)', 'global.mockEngine(new WinEngineHost(broadcast))'],
  [
    'new EngineProcess(resolveEngineBinary())',
    'global.mockEngine(new EngineProcess(resolveEngineBinary()))'
  ],
  ['const micWatcher = new MicWatcher(', 'const micWatcher = global.qaWatcher = new MicWatcher(']
]) {
  assert.ok(source.includes(from), `Missing integration boundary: ${from}`)
  source = source.replace(from, to)
}
fs.writeFileSync(path.join(temp, 'source.cjs'), source)
fs.writeFileSync(
  path.join(temp, 'main.cjs'),
  `
const electron=require('electron'); const fs=require('node:fs'); const path=require('node:path');
electron.app.setAppPath(${JSON.stringify(desktop)});
electron.app.setPath('userData',${JSON.stringify(profile)});
const cp=require('node:child_process'); const spawn=cp.spawn;
cp.spawn=(binary,args,options)=>binary==='powershell.exe'||args?.[0]==='micmon'
 ? Object.assign(new(require('node:events').EventEmitter)(),{stdin:new(require('node:stream').PassThrough)(),stdout:new(require('node:stream').PassThrough)(),stderr:new(require('node:stream').PassThrough)(),killed:false,kill(){return true}})
 : spawn(binary,args,options);
global.stops=0;
global.mockEngine=engine=>{
 global.qaEngine=engine; engine.startServe=()=>{}; engine.listInputDevices=async()=>[];
 engine.start=(command,filePath,opts)=>{
  global.opts=opts; engine.sessionActive=true;
  engine.emit({event:'started',command,binaryPath:'synthetic'});
  engine.emit({event:'ready'});
 };
 engine.stop=()=>{
  global.stops++;
  engine.emit({event:'status',stage:'capture_stopped'});
  engine.emit({event:'timings',channel:'mic',tokens:[{token:'Synthetic ',startSec:0,endSec:0.5,confidence:1},{token:'tail.',startSec:0.5,endSec:1,confidence:1}]});
  engine.emit({event:'final',channel:'mic',text:'Synthetic tail.'});
  const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
  fs.mkdirSync(global.opts.audioDir,{recursive:true});const target=path.join(global.opts.audioDir,'audio.wav');fs.writeFileSync(target,wav);
  engine.emit({event:'audio',path:target,durationMs:1000,startEpochMs:Date.now()});
 };
 global.finish=()=>{engine.emit({event:'done'});engine.sessionActive=false;engine.emit({event:'exit',code:0,signal:null})};
 return engine;
};
const Module=require('node:module'); const mod=new Module(${JSON.stringify(mainPath)},module);
mod.filename=${JSON.stringify(mainPath)};mod.paths=Module._nodeModulePaths(${JSON.stringify(path.dirname(mainPath))});require.cache[mod.filename]=mod;
mod._compile(fs.readFileSync(${JSON.stringify(path.join(temp, 'source.cjs'))},'utf8'),mod.filename);
`
)
let runtime
;(async () => {
  try {
    runtime = await _electron.launch({
      executablePath: require(path.join(desktop, 'node_modules/electron')),
      args: [path.join(temp, 'main.cjs')],
      env: {
        ...process.env,
        DOODLE_USER_DATA: profile,
        DOODLE_NOTE_MCP_CONFIG: path.join(temp, 'mcp.json')
      }
    })
    const page = await runtime.firstWindow()
    await page.waitForFunction(() => !!window.engine && !!window.detect)
    await page.evaluate(() => {
      localStorage.setItem('doodle-onboarding-done', '1')
      localStorage.setItem('doodle-setup-wizard-done', '1')
    })
    await page.reload()
    const meetingId = 'dev336-synthetic-auto-stop'
    await page.evaluate(
      (id) => window.meetings.upsert({ id, title: 'Synthetic auto-stop' }),
      meetingId
    )
    assert.equal(
      await page.locator('.tp-body').count(),
      0,
      'Test starts without an editor listener'
    )
    await page.evaluate(
      (id) => window.engine.start('live', undefined, { meetingId: id }),
      meetingId
    )
    await page.waitForFunction(
      async () => (await window.detect.getState()).autoStopState?.stop?.phase === 'active'
    )
    const first = await page.evaluate(
      async () => (await window.detect.getState()).autoStopState.stop.captureId
    )
    await runtime.evaluate((_, id) => global.qaWatcher.onMeetingEnded(id), first)
    await page.evaluate(() => window.engine.stop()) // Race manual Stop with main-owned automatic Stop.
    await page.waitForFunction(
      async () => (await window.detect.getState()).autoStopState?.stop?.phase === 'stopped'
    )
    assert.equal(await runtime.evaluate(() => global.stops), 1)
    assert.equal(
      (await page.evaluate((id) => window.meetings.get(id), meetingId)).segments[0].text,
      'Synthetic tail.'
    )
    assert.equal((await page.evaluate((id) => window.audio.list(id), meetingId)).length, 1)
    await runtime.evaluate(() => global.finish())
    await page.waitForFunction(
      async () => (await window.detect.getState()).autoStopState?.stop?.phase === 'completed'
    )
    await page.reload()
    const retained = await page.evaluate((id) => window.meetings.get(id), meetingId)
    assert.equal(retained.segments.length, 1)
    assert.equal(retained.segments[0].text, 'Synthetic tail.')
    await page.evaluate(
      (id) => window.engine.start('live', undefined, { meetingId: id }),
      meetingId
    )
    await page.waitForFunction(
      async () => (await window.detect.getState()).autoStopState?.stop?.phase === 'active'
    )
    await runtime.evaluate((_, id) => global.qaWatcher.onMeetingEnded(id), first)
    assert.equal(
      await runtime.evaluate(() => global.stops),
      1,
      'Old timer cannot stop resumed capture'
    )
    await page.evaluate(() => window.engine.stop())
    await page.waitForFunction(
      async () => (await window.detect.getState()).autoStopState?.stop?.phase === 'stopped'
    )
    await runtime.evaluate(() => global.finish())
    await page.waitForFunction(
      async () => (await window.detect.getState()).autoStopState?.stop?.phase === 'completed'
    )
    await page.evaluate(
      (id) => window.engine.start('live', undefined, { meetingId: id }),
      meetingId
    )
    await page.waitForFunction(
      async () => (await window.detect.getState()).autoStopState?.stop?.phase === 'active'
    )
    const third = await page.evaluate(
      async () => (await window.detect.getState()).autoStopState.stop.captureId
    )
    await runtime.evaluate((_, id) => global.qaWatcher.onMeetingEnded(id), third)
    await runtime.evaluate(() => {
      global.qaEngine.emit({
        event: 'error',
        message: 'Synthetic finalization failure; live transcript retained.'
      })
      global.finish()
    })
    await page.waitForFunction(
      async () => (await window.detect.getState()).autoStopState?.stop?.phase === 'failed'
    )
    assert.equal(
      (await page.evaluate((id) => window.meetings.get(id), meetingId)).segments.length,
      3
    )
    assert.equal((await page.evaluate((id) => window.audio.list(id), meetingId)).length, 3)
    console.log(
      JSON.stringify({
        passed: true,
        profile,
        checks: [
          'main Stop without editor',
          'manual/auto race stops once',
          'confirmed capture cessation before completion',
          'terminal transcript and audio persisted',
          'reload persistence',
          'old capture deadline cannot stop Resume',
          'failed finalization retains transcript/audio and never announces success'
        ]
      })
    )
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    if (runtime) {
      if (process.platform === 'win32')
        require('node:child_process').execFileSync(
          'taskkill',
          ['/pid', String(runtime.process().pid), '/T', '/F'],
          { stdio: 'ignore', windowsHide: true }
        )
      else await runtime.close()
    }
  }
})()
