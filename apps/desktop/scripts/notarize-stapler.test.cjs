const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const builderRequire = createRequire(
  require.resolve('electron-builder', { paths: [path.join(__dirname, '..')] })
)
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const staple = appBuilderRequire.resolve('@electron/notarize/lib/staple')
const helper = path.join(__dirname, 'stapler.cjs')
const transient =
  'Response is (null)\nError Domain=NSURLErrorDomain Code=-1005 UserInfo={NSErrorFailingURLStringKey=https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup}\n'

function run(t, config = helper, firstOutput = transient) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notarize-seam-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const calls = path.join(dir, 'calls')
  fs.writeFileSync(
    path.join(dir, 'xcrun'),
    `#!${process.execPath}\nconst fs=require('node:fs'); const f=${JSON.stringify(calls)};const n=fs.existsSync(f)?fs.readFileSync(f,'utf8').trim().split('\\n').length:0;fs.appendFileSync(f,JSON.stringify(process.argv.slice(2))+'\\n');process.stdout.write(n===0?${JSON.stringify(firstOutput)}:'',()=>process.exit(n===0?68:0));\n`,
    { mode: 0o755 }
  )
  const env = {
    ...process.env,
    PATH: dir + path.delimiter + process.env.PATH,
    DOODLENOTE_STAPLER_DIAGNOSTICS: dir
  }
  if (config === null) delete env.DOODLENOTE_STAPLER_HELPER
  else env.DOODLENOTE_STAPLER_HELPER = config
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `require(${JSON.stringify(staple)}).stapleApp({appPath:${JSON.stringify(path.join(dir, 'unchanged app.app'))}}).catch(()=>process.exitCode=1)`
    ],
    { env, encoding: 'utf8', timeout: 20000 }
  )
  return {
    result,
    dir,
    calls: fs.existsSync(calls)
      ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse)
      : []
  }
}

test('actual installed builder notarize staple boundary retries without resubmission', (t) => {
  const { result, dir, calls } = run(t)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    calls,
    Array(2).fill(['stapler', 'staple', '-v', path.join(dir, 'unchanged app.app')])
  )
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'staple-package-app-1.json'))).reason,
    'ticket-connection-lost'
  )
})

for (const config of [null, 'relative.cjs', '/nonexistent/helper.cjs']) {
  test('missing or invalid helper config fails closed: ' + config, (t) => {
    const { result, calls } = run(t, config)
    assert.equal(result.status, 1)
    assert.equal(calls.length, 0)
  })
}

test('installed boundary plain 68 is terminal, no outer retry amplification', (t) => {
  const { result, calls } = run(t, helper, 'Error 68')
  assert.equal(result.status, 1)
  assert.equal(calls.length, 1)
})

test('installed package keeps signature and Accepted submission ahead of its single staple call', () => {
  const index = fs.readFileSync(appBuilderRequire.resolve('@electron/notarize'), 'utf8')
  const signature = index.indexOf('yield (0, check_signature_1.checkSignatures)')
  const submit = index.indexOf('yield (0, notarytool_1.notarizeAndWaitForNotaryTool)')
  const stapleCall = index.indexOf('yield (0, staple_1.stapleApp)')
  assert.ok(signature > 0 && submit > signature && stapleCall > submit)
  assert.doesNotMatch(index, /promise_retry|retries:/)
  const notary = fs.readFileSync(
    appBuilderRequire.resolve('@electron/notarize/lib/notarytool'),
    'utf8'
  )
  assert.match(notary, /result.code === 0 && parsed.status === 'Accepted'/)
})

test('non-CI package command supplies the same absolute helper without invoking a build', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'package-config-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(
    path.join(dir, 'electron-builder'),
    `#!${process.execPath}\nprocess.stdout.write(process.env.DOODLENOTE_STAPLER_HELPER || 'missing')\n`,
    { mode: 0o755 }
  )
  const desktop = path.join(__dirname, '..')
  const command = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')))
    .scripts.package.split(' && ')
    .at(-1)
  const result = spawnSync('/bin/sh', ['-c', command], {
    cwd: desktop,
    encoding: 'utf8',
    env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH }
  })
  assert.equal(result.status, 0)
  assert.equal(fs.realpathSync(result.stdout), fs.realpathSync(helper))
})
