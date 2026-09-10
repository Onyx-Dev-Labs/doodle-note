/* Launches the built Electron app with a fresh profile and a fake engine.
 * Never starts native capture, reads the user's profile, or changes TCC.
 * pnpm --filter desktop build
 * DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-permission-preflight.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const desktop = resolve(__dirname, '..')
const root = fs.mkdtempSync(join(tmpdir(), 'ony275-launch-'))
const appDir = join(root, 'apps', 'desktop')
const profile = join(root, 'profile')
const log = join(root, 'engine-args.jsonl')
const engineDir = join(root, 'engine', '.build', 'release')
fs.mkdirSync(appDir, {recursive:true})
fs.mkdirSync(engineDir, {recursive:true})
fs.cpSync(join(desktop, 'out'), join(appDir, 'out'), {recursive:true})
fs.cpSync(join(desktop, 'resources'), join(appDir, 'resources'), {recursive:true})
fs.copyFileSync(join(desktop, 'package.json'), join(appDir, 'package.json'))
fs.symlinkSync(join(desktop, 'node_modules'), join(appDir, 'node_modules'), 'dir')
fs.writeFileSync(join(engineDir, 'engine'), `#!/bin/sh
exec '${process.execPath.replaceAll("'", "'\\''")}' '${join(root, 'engine.cjs').replaceAll("'", "'\\''")}' "$@"
`, {mode:0o755})
fs.writeFileSync(join(root, 'engine.cjs'), `
const fs=require('node:fs');const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
const emit=x=>console.log(JSON.stringify(x));
if(args[0]==='preflight'){
  if(!args.includes('--models-only')){
    emit({event:'status',stage:'preflight_mic',granted:true});
    emit({event:'status',stage:'preflight_screen',granted:true});
  }
  emit({event:'status',stage:'preflight_models'});emit({event:'ready',mode:'preflight'});
}else if(args[0]==='serve'||args[0]==='micmon'){
  if(args[0]==='serve')emit({event:'status',stage:'serve_ready'});
  process.stdin.resume();process.stdin.on('end',()=>process.exit(0));
}else if(args[0]==='devices'){emit({event:'devices',inputs:[]});}
`)
const calls = () => fs.existsSync(log) ? fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []

async function main() {
  console.log('Electron QA artifacts:', root)
  for (let launch=0;launch<2;launch++) {
    const before = calls().filter(args=>args[0]==='preflight').length
    const app = await _electron.launch({executablePath:require(join(desktop,'node_modules','electron')),args:[appDir],env:{...process.env,DOODLE_USER_DATA:profile}})
    try {
      const page=await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForFunction(()=>!!window.wizard)
      // Reading UI and captured argv proves the app's actual launch path uses models-only.
      const preflights=calls().filter(args=>args[0]==='preflight').slice(before)
      assert.deepEqual(preflights,[['preflight','--models-only']])
      if (!launch) {
        const result=await page.evaluate(()=>window.wizard.runPreflight())
        assert.deepEqual(result,{ok:true,micGranted:true,screenGranted:true})
        assert.deepEqual(calls().filter(args=>args[0]==='preflight').at(-1),['preflight'])
        await page.evaluate(()=>{
          localStorage.setItem('doodle-onboarding-done','1')
          localStorage.setItem('doodle-setup-wizard-done','1')
        })
      }
    } finally { await app.close() }
  }
  console.log('PASS: fresh launch and completed-profile relaunch warm models only; explicit onboarding still runs full permission preflight')
}
main().catch(error=>{console.error(error);process.exitCode=1})
