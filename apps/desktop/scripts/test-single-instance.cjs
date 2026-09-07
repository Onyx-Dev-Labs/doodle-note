// Uses an isolated profile; never points either process at a user's library.
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const { mkdtempSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')

async function main() {
  const executable = resolve(process.argv[2])
  const appDirectory = process.argv[3]
  const profile = mkdtempSync(join(tmpdir(), 'doodle-instance-qa-'))
  const args = [...(appDirectory ? [resolve(appDirectory)] : []), `--user-data-dir=${profile}`]
  let first, second
  try {
    first = await _electron.launch({ executablePath: executable, args, timeout: 30000 })
    await first.firstWindow()
    await first.evaluate(({ app }) => {
      globalThis.secondInstanceCount = 0
      app.on('second-instance', () => globalThis.secondInstanceCount++)
    })
    const firstPid = await first.evaluate(() => process.pid)
    try {
      second = await _electron.launch({ executablePath: executable, args, timeout: 10000 })
    } catch {
      // A losing instance exits before Playwright can attach to it.
    }
    assert.ok(!second, 'A second process must not open the same library and run another updater')
    assert.equal(first.process().exitCode, null, 'The original app must remain running')
    assert.equal(
      await first.evaluate(() => globalThis.secondInstanceCount),
      1,
      'The original app must receive the second launch'
    )
    assert.equal(await first.evaluate(() => process.pid), firstPid)
    console.log('Single-instance Windows launch passed')
  } finally {
    for (const app of [second, first]) {
      if (app && app.process().exitCode === null)
        spawnSync('taskkill', ['/PID', String(app.process().pid), '/T', '/F'], {
          windowsHide: true
        })
    }
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
