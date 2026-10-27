const { test } = require('node:test')
// Never contaminate the candidate job's evidence with synthetic test records.
delete process.env.DOODLENOTE_STAPLER_DIAGNOSTICS
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const transient =
  'Response is (null)\nerror is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost." UserInfo={NSErrorFailingURLStringKey=https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup}\n'
function fixture(t, responses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stapler-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const calls = path.join(dir, 'calls.jsonl')
  const executable = path.join(dir, 'xcrun')
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\nconst fs=require('node:fs');\nconst file=${JSON.stringify(calls)};\nconst n=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\\n').length:0;\nfs.appendFileSync(file,JSON.stringify(process.argv.slice(2))+'\\n');\nconst r=${JSON.stringify(responses)}[n] || {code:99};\nprocess.stdout.write(r.output || '',()=>process.exit(r.code));\n`,
    { mode: 0o755 }
  )
  return {
    dir,
    calls,
    executable,
    invocations: () =>
      fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : []
  }
}

test('current invocation transport failure retries the same artifact then succeeds', async (t) => {
  const f = fixture(t, [{ code: 68, output: transient }, { code: 0 }])
  const { runStapler } = require('./stapler.cjs')
  const result = await runStapler(
    {
      action: 'staple',
      role: 'package-app',
      artifact: path.join(f.dir, 'same app.app'),
      diagnosticsDir: f.dir
    },
    { executable: f.executable, delaysMs: [1, 1] }
  )
  assert.equal(result.code, 0)
  assert.equal(result.attempts.length, 2)
  assert.deepEqual(
    f.invocations(),
    Array(2).fill(['stapler', 'staple', '-v', path.join(f.dir, 'same app.app')])
  )
})

for (const [name, output, count, reason] of [
  ['exhausts three', transient, 3, 'ticket-connection-lost'],
  ['plain 68', 'Error 68', 1, 'unclassified'],
  ['wrong host', transient.replace('api.apple-cloudkit.com', 'example.com'), 1, 'unclassified'],
  ['endpoint suffix', transient.replace('/lookup}', '/lookup/extra}'), 1, 'unclassified'],
  [
    'missing null response',
    transient.replace('Response is (null)', 'Response is 200'),
    1,
    'unclassified'
  ],
  ['TLS conflict', transient + 'TLS handshake failed', 1, 'terminal-diagnostic'],
  ['certificate conflict', transient + 'certificate invalid', 1, 'terminal-diagnostic'],
  ['revoked ticket conflict', transient + 'ticket revoked', 1, 'terminal-diagnostic'],
  ['missing ticket conflict', transient + 'Could not find ticket', 1, 'terminal-diagnostic'],
  [
    'missing encoded ticket conflict',
    transient + 'Could not find base64 encoded ticket in response',
    1,
    'terminal-diagnostic'
  ],
  ['record absent conflict', transient + 'Record not found', 1, 'terminal-diagnostic'],
  ['other URL error conflict', transient + 'NSURLErrorDomain Code=-1200', 1, 'terminal-diagnostic']
]) {
  test(name + ' fails closed with bounded invocations', async (t) => {
    const f = fixture(t, Array(3).fill({ code: 68, output }))
    const result = await require('./stapler.cjs').runStapler(
      { action: 'validate', role: 'dmg', artifact: '/same.dmg' },
      { executable: f.executable, delaysMs: [1, 1], log() {} }
    )
    assert.equal(result.code, 1)
    assert.equal(result.reason, reason)
    assert.equal(f.invocations().length, count)
  })
}

test('normal success is one invocation; unknown output never leaks', async (t) => {
  const f = fixture(t, [
    { code: 0, output: 'secret=DO-NOT-LOG password=hidden keychain /private/path' }
  ])
  let logged = ''
  const result = await require('./stapler.cjs').runStapler(
    { action: 'validate', role: 'build-app', artifact: '/same.app', diagnosticsDir: f.dir },
    {
      executable: f.executable,
      log(line) {
        logged += line
      }
    }
  )
  assert.equal(result.code, 0)
  assert.equal(f.invocations().length, 1)
  assert.doesNotMatch(
    logged + fs.readFileSync(path.join(f.dir, 'validate-build-app-1.json')),
    /DO-NOT-LOG|password|keychain|private/
  )
})

test('output limit is terminal even with a positive prefix and terminal suffix', async (t) => {
  const f = fixture(t, [
    { code: 68, output: transient + 'x'.repeat(100000) + 'certificate revoked' }
  ])
  const result = await require('./stapler.cjs').runStapler(
    { action: 'validate', role: 'dmg', artifact: '/same.dmg', diagnosticsDir: f.dir },
    { executable: f.executable, delaysMs: [1, 1], log() {} }
  )
  assert.equal(result.reason, 'output-limit')
  assert.equal(f.invocations().length, 1)
  assert.equal(result.attempts[0].capturedBytes, 65536)
  assert.ok(fs.statSync(path.join(f.dir, 'validate-dmg-1.json')).size < 2048)
})

test('classification does not reuse previous invocation output', async (t) => {
  const f = fixture(t, [
    { code: 68, output: transient },
    { code: 68, output: 'Error 68' }
  ])
  const result = await require('./stapler.cjs').runStapler(
    { action: 'staple', role: 'dmg', artifact: '/same.dmg' },
    { executable: f.executable, delaysMs: [1, 1], log() {} }
  )
  assert.equal(result.reason, 'unclassified')
  assert.equal(f.invocations().length, 2)
})

for (const mode of ['timeout', 'cancelled', 'signal', 'total-timeout']) {
  test(mode + ' drains and kills owned subprocess descendants without retry', async (t) => {
    const f = fixture(t, [])
    const pidFile = path.join(f.dir, 'pid')
    fs.writeFileSync(
      f.executable,
      `#!${process.execPath}\nconst {spawn}=require('node:child_process');\nconst fs=require('node:fs');\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});\nfs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));\nprocess.stdout.write(${JSON.stringify(transient)});\n${mode === 'signal' ? "setTimeout(()=>process.kill(process.pid,'SIGTERM'),30);" : 'setInterval(()=>{},1000);'}\n`
    )
    let cancellation
    if (mode === 'cancelled')
      cancellation = setInterval(() => {
        if (fs.existsSync(pidFile)) {
          clearInterval(cancellation)
          process.kill(process.pid, 'SIGTERM')
        }
      }, 5)
    const result = await require('./stapler.cjs').runStapler(
      { action: 'validate', role: 'dmg', artifact: '/same.dmg' },
      {
        executable: f.executable,
        timeoutMs: mode === 'timeout' ? 1000 : 5000,
        totalMs: mode === 'total-timeout' ? 1000 : 6000,
        delaysMs: [1, 1],
        log() {}
      }
    )
    clearInterval(cancellation)
    assert.equal(result.code, 1)
    assert.equal(result.reason, mode)
    assert.equal(result.attempts.length, 1)
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    // Reaping by launchd may lag close by a few milliseconds.
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(pid, 0)
      } catch {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail('owned descendant still alive')
  })
}

test('invalid configuration fails before spawning; production bounds are fixed', async (t) => {
  const f = fixture(t, [])
  const { runStapler, POLICY } = require('./stapler.cjs')
  assert.deepEqual(POLICY, {
    attempts: 3,
    delaysMs: [10000, 30000],
    timeoutMs: 60000,
    totalMs: 219000
  })
  await assert.rejects(
    runStapler({ action: 'invalid', role: 'dmg', artifact: '/a' }, { executable: f.executable })
  )
  await assert.rejects(
    runStapler(
      { action: 'staple', role: 'dmg', artifact: '/a', diagnosticsDir: 'relative' },
      { executable: f.executable }
    )
  )
  assert.equal(f.invocations().length, 0)
})

test('cancellation during backoff stops before a second invocation and records final reason', async (t) => {
  const f = fixture(t, [{ code: 68, output: transient }, { code: 0 }])
  const result = await require('./stapler.cjs').runStapler(
    { action: 'staple', role: 'dmg', artifact: '/same.dmg', diagnosticsDir: f.dir },
    {
      executable: f.executable,
      delaysMs: [1000, 1000],
      log() {
        setTimeout(() => process.kill(process.pid, 'SIGINT'), 20)
      }
    }
  )
  assert.equal(result.reason, 'cancelled')
  assert.equal(f.invocations().length, 1)
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.dir, 'staple-dmg-result.json'))).reason,
    'cancelled'
  )
})
