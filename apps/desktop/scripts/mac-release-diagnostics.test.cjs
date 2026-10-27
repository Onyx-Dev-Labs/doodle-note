const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const script = path.join(__dirname, 'mac-release-diagnostics.cjs')

for (const [name, input, expected] of [
  [
    'Accepted',
    JSON.stringify({
      status: 'Accepted',
      id: '12345678-abcd-1234-abcd-123456789abc',
      secret: 'DO-NOT-LOG'
    }),
    0
  ],
  [
    'rejected',
    JSON.stringify({ status: 'Invalid', id: '12345678-abcd-1234-abcd-123456789abc' }),
    1
  ],
  ['malformed', 'not JSON', 1],
  ['oversize', 'x'.repeat(100000), 1]
]) {
  test('DMG Accepted evidence is bounded and fails closed: ' + name, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-diagnostic-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const result = spawnSync(process.execPath, [script, 'accepted'], {
      input,
      encoding: 'utf8',
      env: { ...process.env, DOODLENOTE_STAPLER_DIAGNOSTICS: dir }
    })
    assert.equal(result.status, expected, result.stderr)
    const saved = fs.readFileSync(path.join(dir, 'notary-dmg.json'), 'utf8')
    assert.ok(saved.length < 512)
    assert.doesNotMatch(saved + result.stdout + result.stderr, /DO-NOT-LOG/)
    assert.equal(JSON.parse(saved).accepted, expected === 0)
  })
}

test('summary distinguishes failed and skipped stages without dumping environment', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-summary-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [script, 'collect'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOODLENOTE_STAPLER_DIAGNOSTICS: dir,
      RELEASE_STAGE_OUTCOMES: JSON.stringify({
        package: 'failure',
        dmg: 'skipped',
        verify: 'skipped',
        candidate: 'skipped',
        injected: 'DO-NOT-LOG'
      }),
      GITHUB_RUN_ID: '40567259458',
      GITHUB_RUN_ATTEMPT: '3',
      GITHUB_SHA: 'a'.repeat(40),
      SECRET: 'DO-NOT-LOG'
    }
  })
  assert.equal(result.status, 0, result.stderr)
  const saved = fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')
  const summary = JSON.parse(saved)
  assert.equal(summary.stages.package, 'failure')
  assert.equal(summary.stages.verify, 'skipped')
  assert.equal(summary.runId, '40567259458')
  assert.equal(summary.runAttempt, '3')
  assert.equal(summary.candidateRecovery, 'unavailable-without-retained-bytes')
  assert.doesNotMatch(saved, /DO-NOT-LOG|SECRET|injected/)
  assert.ok(saved.length < 16384)
})
