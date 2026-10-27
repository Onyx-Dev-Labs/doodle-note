// Synthetic tool-boundary fixtures: no app launch, signing or Apple requests.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function verify(t, failure = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-gates-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const scripts = path.join(dir, 'scripts')
  const release = path.join(dir, 'release')
  const app = path.join(release, 'mac-arm64/DoodleNote.app')
  const bin = path.join(dir, 'bin')
  for (const d of [scripts, path.join(app, 'Contents'), bin]) fs.mkdirSync(d, { recursive: true })
  for (const name of ['verify-mac-release.sh', 'stapler.cjs', 'mac-release-manifest.rb']) {
    fs.copyFileSync(
      name === 'verify-mac-release.sh' && process.env.VERIFIER_UNDER_TEST
        ? process.env.VERIFIER_UNDER_TEST
        : path.join(__dirname, name),
      path.join(scripts, name)
    )
  }
  if (failure === 'missing-helper') fs.unlinkSync(path.join(scripts, 'stapler.cjs'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  fs.writeFileSync(
    path.join(app, 'Contents/Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${failure === 'version' ? '1.2.4' : '1.2.3'}</string></dict></plist>`
  )
  const names = ['DoodleNote-1.2.3-arm64-mac.zip', 'DoodleNote-1.2.3-arm64.dmg']
  const entries = names.map((name) => {
    const bytes = Buffer.from('synthetic ' + name)
    fs.writeFileSync(path.join(release, name), bytes)
    return {
      url: name,
      sha512: createHash('sha512').update(bytes).digest('base64'),
      size: bytes.length
    }
  })
  const manifest = { version: '1.2.3', files: entries, path: names[0], sha512: entries[0].sha512 }
  fs.writeFileSync(path.join(release, 'latest-mac.yml'), JSON.stringify(manifest))
  if (failure === 'hash') fs.appendFileSync(path.join(release, names[0]), 'tampered')
  const before = names.map((name) => fs.readFileSync(path.join(release, name)))
  const trace = path.join(dir, 'trace')
  const fake = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const name=path.basename(process.argv[1]),args=process.argv.slice(2),failure=${JSON.stringify(failure)},app=${JSON.stringify(app)},trace=${JSON.stringify(trace)};
fs.appendFileSync(trace,JSON.stringify([name,...args])+'\\n');
if(name==='codesign') {
  if(args[0]==='--display') console.log('TeamIdentifier='+(failure==='team'?'WRONGTEAM0':'VTZW6K32K4'));
  else if(failure==='signature') process.exit(1);
}
if(name==='xcrun') {
  const count=fs.readFileSync(trace,'utf8').trim().split('\\n').map(JSON.parse).filter(x=>x[0]==='xcrun').length;
  if(failure==='validate-'+count) { console.log('Error 68'); process.exit(68); }
}
if(name==='spctl' && failure==='gatekeeper') process.exit(1);
if(name==='ditto') {
  const target=path.join(args.at(-1),'DoodleNote.app');fs.cpSync(app,target,{recursive:true});
  if(failure==='zip-equality') fs.writeFileSync(path.join(target,'extra'),'different');
}
if(name==='hdiutil' && args[0]==='attach') {
  const target=path.join(args.at(-1),'DoodleNote.app');fs.cpSync(app,target,{recursive:true});
  if(failure==='dmg-equality') fs.writeFileSync(path.join(target,'extra'),'different');
}
`
  for (const name of ['codesign', 'xcrun', 'spctl', 'ditto', 'hdiutil'])
    fs.writeFileSync(path.join(bin, name), fake, { mode: 0o755 })
  const result = spawnSync('/bin/bash', [path.join(scripts, 'verify-mac-release.sh')], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      PATH: bin + path.delimiter + process.env.PATH,
      EXPECTED_TEAM_ID: 'VTZW6K32K4',
      GITHUB_SHA: 'a'.repeat(40),
      DOODLENOTE_STAPLER_DIAGNOSTICS: path.join(dir, 'diagnostics')
    }
  })
  for (let i = 0; i < names.length; i++)
    assert.deepEqual(
      fs.readFileSync(path.join(release, names[i])),
      before[i],
      'verification must not mutate archives'
    )
  return {
    result,
    dir,
    receipt: path.join(release, 'release-receipt.txt'),
    trace: fs.existsSync(trace)
      ? fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse)
      : []
  }
}

test('real verifier routes all four validations and writes receipt only after equality and hashes', (t) => {
  const { result, dir, receipt, trace } = verify(t)
  assert.equal(result.status, 0, result.stderr)
  for (const role of ['build-app', 'dmg', 'zip-app', 'dmg-app']) {
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, 'diagnostics', `validate-${role}-1.json`))).reason,
      'success'
    )
  }
  assert.equal(
    trace.filter((x) => x[0] === 'xcrun' && x[1] === 'stapler').length,
    4,
    JSON.stringify(trace)
  )
  assert.ok(
    trace
      .filter((x) => x[0] === 'xcrun' && x[1] === 'stapler')
      .every((x) => x[1] === 'stapler' && x[2] === 'validate')
  )
  assert.match(
    fs.readFileSync(receipt, 'utf8'),
    /Verified app\/ZIP\/DMG payloads, signatures, tickets, Gatekeeper, version and manifest SHA-512 hashes/
  )
})

for (const failure of [
  'signature',
  'team',
  'validate-1',
  'validate-2',
  'validate-3',
  'validate-4',
  'gatekeeper',
  'version',
  'zip-equality',
  'dmg-equality',
  'hash',
  'missing-helper'
]) {
  test('verifier fails before receipt for ' + failure, (t) => {
    const { result, receipt, trace } = verify(t, failure)
    assert.notEqual(result.status, 0)
    assert.equal(fs.existsSync(receipt), false)
    if (failure.startsWith('validate-'))
      assert.equal(
        trace.filter((x) => x[0] === 'xcrun' && x[1] === 'stapler').length,
        Number(failure.at(-1))
      )
    if (['signature', 'team', 'missing-helper'].includes(failure))
      assert.equal(trace.filter((x) => x[0] === 'xcrun' && x[1] === 'stapler').length, 0)
  })
}
