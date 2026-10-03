import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeUpdateDiagnostic } from './update-diagnostics'

test('update diagnostics retain only version and lifecycle data and rotate a bounded log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'update-log-test-'))
  try {
    const file = join(dir, 'updates.log')
    writeUpdateDiagnostic(file, 'launch', '0.4.23', 'secret/path?token=private')
    const entry = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(entry.event, 'launch')
    assert.equal(entry.version, '0.4.23')
    assert.equal(entry.targetVersion, undefined)
    assert.doesNotMatch(readFileSync(file, 'utf8'), /secret|private/)
    writeFileSync(file, 'x'.repeat(512 * 1024))
    writeUpdateDiagnostic(file, 'installer-error', '0.4.23')
    assert.ok(existsSync(file + '.previous'))
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).event, 'installer-error')
    assert.doesNotThrow(() =>
      writeUpdateDiagnostic(join(dir, 'missing', 'updates.log'), 'launch', '0.4.23')
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
