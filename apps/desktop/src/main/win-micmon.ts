/**
 * Windows counterpart of the engine's `micmon` command: a PowerShell poll
 * loop over the CapabilityAccessManager ConsentStore, which Windows keeps
 * current for every app that touches the microphone (it powers the systray
 * mic indicator). An app with LastUsedTimeStart set and LastUsedTimeStop=0
 * holds the mic RIGHT NOW — that's the same per-app attribution macOS 14.4
 * gives us via CoreAudio process objects, with zero native code.
 *
 * The script emits the exact micmon NDJSON shape on every state CHANGE
 * (never per-poll — MicWatcher's debounce re-arms on each event):
 *   {"event":"micmon","running":bool,"bundles":[keyNames],"outputBundles":[]}
 *
 * bundles are lowercased ConsentStore key names: NonPackaged keys are exe
 * paths with '#' for '\' (…#zoom#bin#zoom.exe), packaged apps are package
 * family names (MSTeams_8wekyb3d8bbwe) — mic-watcher-logic matches both by
 * substring. outputBundles stays empty: the registry has no speaker-side
 * equivalent, so ring detection remains macOS-only.
 */

export const WIN_MICMON_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$root = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'
$prev = $null
while ($true) {
  if ($env:DOODLE_PARENT_PID) {
    if (-not (Get-Process -Id ([int]$env:DOODLE_PARENT_PID) -ErrorAction SilentlyContinue)) { exit }
  }
  $inUse = New-Object System.Collections.Generic.List[string]
  foreach ($key in (Get-ChildItem $root -ErrorAction SilentlyContinue)) {
    if ($key.PSChildName -eq 'NonPackaged') {
      foreach ($sub in (Get-ChildItem $key.PSPath -ErrorAction SilentlyContinue)) {
        $v = Get-ItemProperty $sub.PSPath -ErrorAction SilentlyContinue
        if ($v.LastUsedTimeStart -gt 0 -and $v.LastUsedTimeStop -eq 0) {
          $inUse.Add($sub.PSChildName.ToLower())
        }
      }
    } else {
      $v = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
      if ($v.LastUsedTimeStart -gt 0 -and $v.LastUsedTimeStop -eq 0) {
        $inUse.Add($key.PSChildName.ToLower())
      }
    }
  }
  $list = @($inUse | Sort-Object -Unique)
  $sig = $list -join '|'
  if ($sig -ne $prev) {
    $prev = $sig
    $payload = @{ event = 'micmon'; running = ($list.Count -gt 0); bundles = $list; outputBundles = @() }
    Write-Output (ConvertTo-Json $payload -Compress)
  }
  Start-Sleep -Milliseconds 1500
}
`

/** Args for spawning powershell.exe with the monitor script. */
export const WIN_MICMON_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  WIN_MICMON_SCRIPT
]
