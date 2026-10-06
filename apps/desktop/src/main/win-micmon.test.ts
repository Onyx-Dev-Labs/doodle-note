import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { WIN_MICMON_SCRIPT } from './win-micmon'

test(
  'registry read failure emits unavailable, then recovers without inventing absence',
  { skip: process.platform !== 'win32' },
  () => {
    // Execute the production PowerShell loop. Only the registry and sleep boundary
    // are synthetic; never read or mutate real microphone attribution.
    const fixture = `
$script:sample = 0
function Get-ChildItem { param($Path, $ErrorAction)
  if ($script:sample -eq 1) { throw 'synthetic registry failure' }
  if ($script:sample -eq 0) { [pscustomobject]@{PSChildName='MSTeams_fixture';PSPath='fixture'} }
}
function Get-ItemProperty { param($Path, $ErrorAction)
  [pscustomobject]@{LastUsedTimeStart=100;LastUsedTimeStop=0}
}
function Start-Sleep { param($Milliseconds)
  $script:sample++
  if ($script:sample -ge 3) { exit 0 }
}
`
    const env = { ...process.env }
    delete env.DOODLE_PARENT_PID
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(fixture + WIN_MICMON_SCRIPT, 'utf16le').toString('base64')
      ],
      { encoding: 'utf8', windowsHide: true, env, timeout: 10000 }
    )
    assert.equal(result.status, 0, result.stderr)
    const events = result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
    assert.equal(events.length, 3)
    assert.equal(events[0].running, true)
    assert.equal(events[1].valid, false)
    assert.equal(events[1].running, undefined)
    assert.equal(events[2].valid, true)
    assert.equal(events[2].running, false)
  }
)
