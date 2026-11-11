// High-DPI capture of the packaged Windows app. For each scale factor it launches
// the app with --force-device-scale-factor=<f> and a fresh isolated profile, then
// saves screenshots of the main window (Home), Settings and, when Bark is
// enabled in that profile, the dictation pill, plus a JSON report of window and
// work-area geometry (the window must fit its display's work area).
//
// It opens visible windows on the desktop: run it only on a machine where that
// is allowed. It never touches an installed DoodleNote or its profile, and
// terminates only the app it launched.
//
//   node capture-windows-dpi.cjs <DoodleNote.exe> <out-dir> [--profiles <dir>] [--scales 1.25,1.5,2]
//
// Requires Playwright 1.62.1 (set DOODLE_PLAYWRIGHT_MODULE for an external install).
// Window captures use PrintWindow(PW_RENDERFULLCONTENT) through PowerShell so the
// native caption buttons (Window Controls Overlay) are included.
//
// Not covered by a forced scale factor: the notification-area icon and its menu
// are drawn by the Windows shell at the system DPI. Check those by changing the
// display scale in Windows Settings (or on a second monitor with another scale).
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const PRINT_WINDOW = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class DnCap {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
}
"@
$h = [IntPtr][Int64]$env:DN_HWND
$r = New-Object DnCap+RECT; [void][DnCap]::GetWindowRect($h, [ref]$r)
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
[void][DnCap]::PrintWindow($h, $dc, 2)
$g.ReleaseHdc($dc); $bmp.Save($env:DN_OUT); $g.Dispose(); $bmp.Dispose()
"$($r.R - $r.L)x$($r.B - $r.T)"
`

function parseArgs(argv) {
  const [executable, out, ...rest] = argv
  if (!executable || !out)
    throw new Error(
      'usage: capture-windows-dpi.cjs <DoodleNote.exe> <out-dir> [--profiles <dir>] [--scales 1.25,1.5,2]'
    )
  const option = (name, fallback) => {
    const i = rest.indexOf(name)
    return i >= 0 ? rest[i + 1] : fallback
  }
  const scales = option('--scales', '1.25,1.5,2')
    .split(',')
    .map(Number)
    .filter((n) => n >= 1 && n <= 4)
  return {
    executable: path.resolve(executable),
    out: path.resolve(out),
    profiles: path.resolve(option('--profiles', path.join(out, 'profiles'))),
    scales
  }
}

/** PrintWindow capture of a native window (HWND buffer from getNativeWindowHandle). */
function printWindow(hwndHex, file) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PRINT_WINDOW],
    {
      env: { ...process.env, DN_HWND: String(BigInt(`0x${hwndHex}`)), DN_OUT: file },
      encoding: 'utf8'
    }
  ).trim()
}

async function captureScale(options, scale) {
  const tag = `scale-${String(scale).replace('.', '_')}`
  const profile = path.join(options.profiles, tag)
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({
    executablePath: options.executable,
    args: [`--user-data-dir=${profile}`, `--force-device-scale-factor=${scale}`],
    env,
    timeout: 60_000
  })
  const report = { scale, profile, shots: {} }
  try {
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    if (path.resolve(userData) !== path.resolve(profile)) throw new Error('profile is not isolated')
    const page = await app.firstWindow()
    await page.evaluate(() => {
      localStorage.setItem('doodle-setup-wizard-done', '1')
      localStorage.setItem('doodle-onboarding-done', '1')
    })
    await page.reload()
    await page.locator('.home-topbar').waitFor()
    await page.waitForTimeout(800)

    const geometry = () =>
      app.evaluate(({ BrowserWindow, screen }) => {
        const main = BrowserWindow.getAllWindows().find(
          (w) => !w.webContents.getURL().startsWith('data:')
        )
        const bounds = main.getBounds()
        const display = screen.getDisplayMatching(bounds)
        return {
          bounds,
          minimumSize: main.getMinimumSize(),
          display: {
            scaleFactor: display.scaleFactor,
            bounds: display.bounds,
            workArea: display.workArea
          },
          hwnd: main.getNativeWindowHandle().readBigUInt64LE(0).toString(16)
        }
      })
    const main = await geometry()
    const area = main.display.workArea
    report.main = main
    report.fitsWorkArea =
      main.bounds.x >= area.x &&
      main.bounds.y >= area.y &&
      main.bounds.x + main.bounds.width <= area.x + area.width &&
      main.bounds.y + main.bounds.height <= area.y + area.height
    report.overlay = await page.evaluate(() =>
      navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON()
    )

    const shot = (name) => {
      const file = path.join(options.out, `${tag}-${name}.png`)
      report.shots[name] = { file, size: printWindow(main.hwnd, file) }
    }
    shot('home')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('.models.settings-redesign').waitFor()
    await page.waitForTimeout(500)
    shot('settings')
    await page.screenshot({ path: path.join(options.out, `${tag}-settings-content.png`) })

    // The pill exists only when Bark is enabled in this profile.
    const pill = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(
        (x) => x.webContents.getURL().startsWith('data:text/html') && x.isVisible()
      )
      return w
        ? { bounds: w.getBounds(), hwnd: w.getNativeWindowHandle().readBigUInt64LE(0).toString(16) }
        : null
    })
    if (pill) {
      const file = path.join(options.out, `${tag}-pill.png`)
      report.pill = { ...pill, file, size: printWindow(pill.hwnd, file) }
    } else {
      report.pill = 'not shown (enable Bark in this isolated profile to capture it)'
    }
  } finally {
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 15_000))])
    try {
      app.process().kill()
    } catch {
      /* already exited */
    }
  }
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  fs.mkdirSync(options.out, { recursive: true })
  const reports = []
  for (const scale of options.scales) {
    const report = await captureScale(options, scale)
    reports.push(report)
    console.log(
      `scale ${scale}: window ${report.main.bounds.width}x${report.main.bounds.height} DIP, ` +
        `work area ${report.main.display.workArea.width}x${report.main.display.workArea.height}, ` +
        `fits=${report.fitsWorkArea}, caption height ${report.overlay.height}`
    )
  }
  fs.writeFileSync(path.join(options.out, 'dpi-report.json'), JSON.stringify(reports, null, 2))
  const failed = reports.filter((r) => !r.fitsWorkArea)
  if (failed.length) {
    console.error(
      `FAIL: the main window exceeds the work area at ${failed.map((r) => r.scale).join(', ')}`
    )
    process.exitCode = 1
  } else {
    console.log('High-DPI captures done; the main window fits the work area at every scale')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
