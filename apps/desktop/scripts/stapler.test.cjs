const { test } = require('node:test')
// Never contaminate the candidate job's evidence with synthetic test records.
delete process.env.DOODLENOTE_STAPLER_DIAGNOSTICS
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const childSource = path.join(__dirname, 'fixtures/stapler-child.cjs')
const harnessSource = path.join(__dirname, 'fixtures/stapler-harness.cjs')

const transient =
  'Response is (null)\nerror is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost." UserInfo={NSErrorFailingURLStringKey=https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup}\n'
function fixture(t, responses, prefix = 'stapler-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const calls = path.join(dir, 'calls.jsonl')
  const executable = path.join(dir, 'xcrun')
  // The only generated line selects this running Node executable for the native
  // shebang. No test data is inserted into the static JavaScript body.
  fs.writeFileSync(
    executable,
    '#!' + process.execPath + '\n' + fs.readFileSync(childSource, 'utf8'),
    {
      mode: 0o755
    }
  )
  const configure = (config) =>
    fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify({ calls, ...config }))
  configure({ kind: 'responses', responses })
  return {
    dir,
    calls,
    executable,
    configure,
    invocations: () =>
      fs.existsSync(calls)
        ? fs
            .readFileSync(calls, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : []
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
  const { groupSignal, ...cleanup } = result.attempts[0].cleanup
  assert.match(groupSignal, /^(sent|not-found)$/)
  assert.deepEqual(cleanup, {
    childExitObserved: true,
    stdoutDrained: true,
    stderrDrained: true,
    forcedReadClose: false
  })
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
    f.configure({ kind: 'same-group', mode, pidFile, output: transient })
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
    totalMs: 219000,
    cleanupMs: 500
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

for (const interruption of ['cancelled', 'total-timeout']) {
  test(
    interruption + ' during backoff releases timers without touching an unrelated process',
    async (t) => {
      const { spawn } = require('node:child_process')
      const sentinel = spawn(process.execPath, [childSource, '--idle'], {
        stdio: 'ignore'
      })
      t.after(async () => {
        const exited = new Promise((resolve) => sentinel.once('exit', resolve))
        sentinel.kill('SIGKILL')
        await exited
      })
      const f = fixture(t, [{ code: 68, output: transient }, { code: 0 }])
      const result = await require('./stapler.cjs').runStapler(
        { action: 'staple', role: 'dmg', artifact: '/same.dmg', diagnosticsDir: f.dir },
        {
          executable: f.executable,
          totalMs: 800,
          delaysMs: [1000, 1000],
          log() {
            if (interruption === 'cancelled')
              setTimeout(() => process.kill(process.pid, 'SIGINT'), 20)
          }
        }
      )
      assert.equal(result.reason, interruption)
      assert.equal(f.invocations().length, 1)
      assert.equal(result.attempts[0].reason, 'ticket-connection-lost')
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(f.dir, 'staple-dmg-result.json'), 'utf8')).reason,
        interruption
      )
      assert.doesNotThrow(() => process.kill(sentinel.pid, 0))
    }
  )
}

for (const mode of [
  'exit-zero',
  'transient-exit',
  'cancelled',
  'timeout',
  'total-timeout',
  'timeout-before-total'
]) {
  test('escaped retained pipes finalize as cleanup-unconfirmed: ' + mode, async (t) => {
    const { spawnSync } = require('node:child_process')
    // Quotes, backticks, a JS-shaped fragment and a Unicode line separator
    // remain literal path data through both JSON and argv subprocess seams.
    const f = fixture(t, [], 'stapler-test-\'"` ;process.exit(77); \u2028-')
    const pidFile = path.join(f.dir, 'escaped.pid')
    const resultFile = path.join(f.dir, 'result.json')
    f.configure({ kind: 'escaped', mode, pidFile, output: transient })
    // An independent harness timeout makes a regression fail without hanging the
    // suite. Only the test knows/cleans this escaped PID; the helper must not.
    let escapedPid
    try {
      const harness = spawnSync(
        process.execPath,
        [harnessSource, mode, pidFile, f.dir, f.executable, resultFile],
        {
          encoding: 'utf8',
          timeout: 2500,
          killSignal: 'SIGKILL'
        }
      )
      escapedPid = Number(fs.readFileSync(pidFile, 'utf8'))
      assert.equal(
        harness.error,
        undefined,
        'helper must release timers/handles and exit before harness timeout'
      )
      assert.equal(harness.status, 0, harness.stderr)
      const { result, elapsedMs } = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
      assert.equal(result.code, 1)
      assert.equal(result.reason, 'cleanup-unconfirmed')
      assert.equal(result.attempts.length, 1)
      assert.equal(f.invocations().length, 1)
      const record = result.attempts[0]
      assert.equal(
        record.failureReason,
        mode === 'exit-zero'
          ? null
          : mode === 'transient-exit'
            ? 'ticket-connection-lost'
            : mode === 'timeout-before-total'
              ? 'timeout'
              : mode
      )
      assert.equal(record.cleanup.childExitObserved, true)
      assert.equal(record.cleanup.stdoutDrained, false)
      assert.equal(record.cleanup.stderrDrained, false)
      assert.equal(record.cleanup.forcedReadClose, true)
      assert.equal(record.retry, false)
      if (mode === 'exit-zero') assert.equal(record.exit, 0)
      assert.ok(elapsedMs < 1600, `short-clock completion took ${elapsedMs}ms`)
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(f.dir, 'validate-dmg-result.json'), 'utf8')).reason,
        'cleanup-unconfirmed'
      )
      assert.doesNotThrow(
        () => process.kill(escapedPid, 0),
        'must not claim/kill an escaped process group'
      )
    } finally {
      if (!escapedPid && fs.existsSync(pidFile))
        escapedPid = Number(fs.readFileSync(pidFile, 'utf8'))
      if (escapedPid) {
        try {
          process.kill(-escapedPid, 'SIGKILL')
        } catch (error) {
          assert.equal(error.code, 'ESRCH')
        }
        let gone = false
        for (let i = 0; i < 100; i++) {
          try {
            process.kill(escapedPid, 0)
          } catch {
            gone = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        assert.equal(gone, true, 'independent test cleanup must leave no escaped fixture alive')
      }
    }
  })
}
