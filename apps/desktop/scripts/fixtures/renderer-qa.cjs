// Synthetic renderer harness: bundled application components in a native Electron
// window, isolated storage, no application main/preload and no network access.
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const desktop = resolve(__dirname, '../..')
const { build } = require(
  require.resolve('esbuild', {
    paths: [require.resolve('vite', { paths: [desktop] })]
  })
)
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')

async function launchRenderer({ name, contents, init = () => {}, width = 1120, height = 920 }) {
  const output = mkdtempSync(join(tmpdir(), `doodle-${name}-`))
  await build({
    stdin: {
      contents: `(${init.toString()})();\n${contents}`,
      resolveDir: join(desktop, 'src/renderer/src'),
      loader: 'tsx'
    },
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    outfile: join(output, 'app.js'),
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' }
  })
  writeFileSync(
    join(output, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="root" style="height:100vh"></div><script src="app.js"></script></body></html>'
  )
  writeFileSync(
    join(output, 'main.cjs'),
    `
    const { app, BrowserWindow, session } = require('electron');
    app.setPath('userData', ${JSON.stringify(join(output, 'profile'))});
    app.whenReady().then(async () => {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
      const win = new BrowserWindow({ width: ${width}, height: ${height}, show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true } });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      await win.loadFile(${JSON.stringify(join(output, 'index.html'))});
    });
  `
  )
  const runtime = await _electron.launch({
    executablePath: require(require.resolve('electron', { paths: [desktop] })),
    args: [join(output, 'main.cjs')]
  })
  const page = await runtime.firstWindow()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Reload with error collection attached so startup errors cannot be missed.
  await page.reload()
  return { runtime, page, output, errors }
}
module.exports = { launchRenderer }
