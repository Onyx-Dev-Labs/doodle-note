import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { test, type TestContext } from 'node:test'
import ts from 'typescript'
import { EngineProcess } from './engine-process'
import type { EngineEvent } from '../shared/engine-events'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'synthetic helper condition timed out')
    await delay(10)
  }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH')
    return false
  }
}
async function fixture(
  t: TestContext,
  graceful = false,
  mode: 'serve' | 'live' = 'serve',
  Engine = EngineProcess
): Promise<{
  engine: EngineProcess
  events: EngineEvent[]
  lines: () => string[]
  pids: () => number[]
}> {
  const dir = mkdtempSync(join(tmpdir(), 'supervised-engine-'))
  const binary = join(dir, 'engine')
  const log = join(dir, 'events')
  const lines = (): string[] =>
    existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
  const pids = (): number[] =>
    lines()
      .filter((line) => line.startsWith('pid '))
      .map((line) => Number(line.slice(4)))
  writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs')
const log = (line) => fs.appendFileSync(${JSON.stringify(log)}, line + '\\n')
log('pid ' + process.pid)
log('command ' + process.argv[2])
setInterval(() => {}, 1000) // No safety exit can satisfy the assertions.
process.on('SIGTERM', () => log('SIGTERM'))
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const { cmd } = JSON.parse(line)
  log(cmd)
  if (cmd === 'start') console.log(JSON.stringify({ event: 'status', stage: 'starting_capture' }))
})
process.stdin.on('end', () => {
  log('EOF')
  if (${graceful}) process.exit(0)
})
console.log(JSON.stringify({ event: 'status', stage: process.argv[2] === 'serve' ? 'serve_ready' : 'starting_capture' }))
log('booted')
`
  )
  chmodSync(binary, 0o755)
  const engine = new Engine(binary, 150, 250, 150, 1_000)
  const events: EngineEvent[] = []
  engine.onEvent((event) => events.push(event))
  t.after(async () => {
    // Only exact PIDs emitted by this test's script. Keep the log until all
    // owned processes are absent, even when the regression fails on the base.
    const disposal = Promise.resolve(engine.dispose()).catch(() => {})
    for (const pid of pids()) if (alive(pid)) process.kill(pid, 'SIGKILL')
    await until(() => pids().every((pid) => !alive(pid)))
    await disposal
    rmSync(dir, { recursive: true, force: true })
  })
  if (mode === 'serve') engine.startServe()
  else engine.start('live')
  await until(() => lines().includes('booted'))
  await delay(30) // Let the serve_ready pipe reach the host before start.
  if (mode === 'serve') engine.start('live')
  await until(() => events.some((e) => e.event === 'status' && e.stage === 'starting_capture'))
  assert.deepEqual(
    lines().filter((line) => line.startsWith('command ')),
    ['command ' + mode]
  )
  assert.equal(
    events.some((event) => event.event === 'ready'),
    false
  )
  return { engine, events, lines, pids }
}

for (const stopFirst of [false, true]) {
  test(
    `awaits actual stubborn serve exit on ${stopFirst ? 'Stop then quit' : 'direct quit'}`,
    { skip: process.platform === 'win32' },
    async (t) => {
      const { engine, events, lines, pids } = await fixture(t)
      if (stopFirst) engine.stop()
      const started = Date.now()
      const shutdown = engine.dispose()
      assert.equal(engine.dispose(), shutdown, 'in-flight shutdown is shared')
      engine.startServe()
      engine.start('live')
      engine.stop()
      await shutdown
      assert.ok(
        pids().every((pid) => !alive(pid)),
        'dispose must observe real child exit before resolving'
      )
      assert.equal(engine.dispose(), shutdown, 'repeated disposal shares completion')
      assert.deepEqual(
        lines().filter((line) => ['stop', 'EOF', 'SIGTERM'].includes(line)),
        ['stop', 'EOF', 'SIGTERM']
      )
      assert.ok(Date.now() - started >= 300, 'both graceful and SIGTERM windows must elapse')
      assert.ok(events.some((e) => e.event === 'exit' && e.signal === 'SIGKILL'))
      engine.startServe()
      engine.start('live')
      await delay(350) // Beyond the pending Stop watchdog.
      assert.equal(pids().length, 1, 'no replacement helper during or after shutdown')
    }
  )
}

// Exercise the production registration with host boundaries injected. This also
// runs on the immutable base, where the hook prematurely invokes process.exit.
function quitHook(
  engine: EngineProcess,
  host: {
    exit: () => void
    quit: () => void
    update: () => boolean
    error: (error: unknown) => void
  }
): (event: { preventDefault(): void }) => void {
  const file = join(__dirname, 'index.ts')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let registration = ''
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'app.on' &&
      node.arguments[0]?.getText(source) === "'before-quit'"
    )
      registration = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(registration)
  let handler: ((event: { preventDefault(): void }) => void) | undefined
  const seam = join(__dirname, 'engine-quit.ts')
  const seamExports = existsSync(seam) ? createRequire(import.meta.url)(seam) : {}
  runInNewContext(
    ts.transpileModule(registration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
      .outputText,
    {
      ...seamExports,
      app: {
        on: (_event: string, callback: typeof handler) => {
          handler = callback
        },
        quit: host.quit
      },
      process: { exit: host.exit },
      engine,
      libraryActivity: { moving: false },
      quitting: false,
      recordingTray: null,
      calendarService: null,
      micWatcher: {
        stop() {
          /* No mic watcher is launched in this host fixture. */
        }
      },
      isQuittingForUpdate: host.update,
      console: { error: (...args: unknown[]) => host.error(args.at(-1)) }
    }
  )
  assert.ok(handler)
  return handler
}

test(
  'ordinary host quit waits for actual stubborn child exit and coalesces repeated requests',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { engine, pids } = await fixture(t)
    let exits = 0
    let prevented = 0
    const hook = quitHook(engine, {
      exit: () => {
        assert.ok(
          pids().every((pid) => !alive(pid)),
          'main exit must follow actual child exit'
        )
        exits++
      },
      quit: () => assert.fail('ordinary quit uses the hard-exit workaround'),
      update: () => false,
      error: (error) => assert.fail(String(error))
    })
    hook({ preventDefault: () => prevented++ })
    hook({ preventDefault: () => prevented++ })
    assert.equal(exits, 0)
    assert.equal(prevented, 2)
    await until(() => exits === 1)
    assert.equal(pids().length, 1)
  }
)

test(
  'graceful serve exit needs no signals and updater resumes a normal quit once',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { engine, events, lines, pids } = await fixture(t, true)
    let quits = 0
    let prevented = 0
    const hook = quitHook(engine, {
      exit: () => assert.fail('updater must not use process.exit'),
      quit: () => {
        assert.ok(pids().every((pid) => !alive(pid)))
        quits++
        hook({ preventDefault: () => prevented++ })
      },
      update: () => true,
      error: (error) => assert.fail(String(error))
    })
    hook({ preventDefault: () => prevented++ })
    hook({ preventDefault: () => prevented++ })
    await until(() => quits === 1)
    assert.equal(prevented, 2, 'resumed update quit proceeds without prevention')
    assert.deepEqual(
      lines().filter((line) => ['stop', 'EOF', 'SIGTERM'].includes(line)),
      ['stop', 'EOF']
    )
    assert.ok(
      events.some((event) => event.event === 'exit' && event.code === 0 && event.signal === null)
    )
  }
)

test(
  'shutdown joins a retired Stop-watchdog child and cancels its scheduled restart',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { engine, lines, pids } = await fixture(t)
    engine.stop()
    await until(() => lines().includes('SIGTERM'))
    assert.ok(alive(pids()[0]), 'retired helper still alive before shutdown')
    await engine.dispose()
    assert.ok(pids().every((pid) => !alive(pid)))
    await delay(1_100)
    assert.equal(pids().length, 1)
    assert.equal(lines().filter((line) => line === 'SIGTERM').length, 1, 'join existing escalation')
  }
)

test(
  'shutdown owns device and self-test helper handles and blocks later helpers',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { engine, pids, lines } = await fixture(t)
    const devices = engine.listInputDevices()
    const probe = engine.tapSelfTest()
    await until(() => lines().filter((line) => line === 'booted').length === 3)
    await engine.dispose()
    assert.ok(pids().every((pid) => !alive(pid)))
    assert.deepEqual(await devices, [])
    assert.equal((await probe).ok, false)
    assert.deepEqual(await engine.listInputDevices(), [])
    assert.equal((await engine.tapSelfTest()).ok, false)
    assert.equal(pids().length, 3)
  }
)

test(
  'shutdown awaits both superseded and current classic children',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { engine, pids, events } = await fixture(t, false, 'live')
    engine.start('live')
    await until(
      () =>
        events.filter((event) => event.event === 'status' && event.stage === 'starting_capture')
          .length === 2
    )
    assert.equal(pids().length, 2)
    await engine.dispose()
    assert.ok(pids().every((pid) => !alive(pid)))
  }
)

test(
  'a quit during supersede notification prevents a late classic spawn',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { engine, pids } = await fixture(t, false, 'live')
    let shutdown: Promise<void> | undefined
    engine.onEvent((event) => {
      if (event.event === 'exit') shutdown = engine.dispose()
    })
    engine.start('live')
    assert.ok(shutdown)
    await shutdown
    assert.ok(pids().every((pid) => !alive(pid)))
    assert.equal(pids().length, 1)
  }
)

test(
  'signal refusal and exit deadline are explicit; host stays alive without duplicate cleanup',
  { skip: process.platform === 'win32' },
  async (t) => {
    // Replace only the OS signal boundary. Spawn a real script, refuse both
    // signals, and never synthesize an exit or rely on a fixture safety timer.
    const nodeRequire = createRequire(import.meta.url)
    const childProcess = nodeRequire('node:child_process') as typeof import('node:child_process')
    const signals: string[] = []
    const diagnostics: string[] = []
    const exports: { EngineProcess?: typeof EngineProcess } = {}
    runInNewContext(
      ts.transpileModule(readFileSync(join(__dirname, 'engine-process.ts'), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
      }).outputText,
      {
        exports,
        setTimeout,
        clearTimeout,
        console: { error: (...args: unknown[]) => diagnostics.push(args.join(' ')) },
        require: (name: string) =>
          name === 'node:child_process'
            ? {
                spawn: (...args: Parameters<typeof childProcess.spawn>) => {
                  const child = childProcess.spawn(...args)
                  child.kill = (signal) => {
                    signals.push(String(signal))
                    return false
                  }
                  return child
                }
              }
            : nodeRequire(name)
      }
    )
    assert.ok(exports.EngineProcess)
    const { engine, pids } = await fixture(t, false, 'serve', exports.EngineProcess)
    const failures: unknown[] = []
    let exits = 0
    const hook = quitHook(engine, {
      exit: () => exits++,
      quit: () => exits++,
      update: () => false,
      error: (error) => failures.push(error)
    })
    hook({
      preventDefault() {
        /* Preventing the injected event has no OS effect. */
      }
    })
    hook({
      preventDefault() {
        /* Preventing the injected event has no OS effect. */
      }
    })
    await until(() => failures.length === 1)
    const failure = failures[0] as AggregateError
    assert.match(String(failure), /Engine shutdown failed/)
    assert.match(String(failure.errors[0]), /exit not observed after SIGKILL deadline/)
    assert.ok(diagnostics.some((line) => line.includes('SIGTERM: Error: signal not delivered')))
    assert.ok(diagnostics.some((line) => line.includes('SIGKILL: Error: signal not delivered')))
    assert.ok(pids().every(alive), 'failure cannot be reported as successful containment')
    hook({
      preventDefault() {
        /* Preventing the injected event has no OS effect. */
      }
    })
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
    assert.equal(exits, 0)
  }
)

test(
  'classic Stop then quit preserves a single SIGTERM and awaits forced exit',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { engine, pids, lines } = await fixture(t, false, 'live')
    engine.stop()
    engine.stop()
    await engine.dispose()
    assert.ok(pids().every((pid) => !alive(pid)))
    assert.equal(lines().filter((line) => line === 'SIGTERM').length, 1)
  }
)
