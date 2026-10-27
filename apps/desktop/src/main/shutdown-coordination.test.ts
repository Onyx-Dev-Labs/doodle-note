import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { LibraryActivity } from './library-activity'
import type { EngineProcess } from './engine-process'
import type { MicWatcher } from './mic-watcher'
import * as storageApi from '../shared/storage-api'
import * as quitSeam from './engine-quit'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((r) => {
      resolve = r
    }),
    resolve: (value) => resolve(value)
  }
}
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 4_000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'coordination condition deadline')
    await delay(10)
  }
}
const nodeRequire = createRequire(import.meta.url)
function load<T>(name: string, deps: Record<string, unknown>): T {
  const exports = {}
  runInNewContext(
    ts.transpileModule(readFileSync(join(__dirname, name), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports,
      process,
      Buffer,
      setTimeout,
      clearTimeout,
      console,
      require: (id: string) => (id in deps ? deps[id] : nodeRequire(id))
    }
  )
  return exports as T
}
function register(name: 'quit' | 'storage', context: Record<string, unknown>): void {
  const path = join(__dirname, 'index.ts')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  let expression = ''
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ((name === 'quit' &&
        node.expression.getText(source) === 'app.on' &&
        node.arguments[0]?.getText(source) === "'before-quit'") ||
        (name === 'storage' && node.expression.getText(source) === 'registerStorageIpc'))
    )
      expression = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression)
  runInNewContext(
    ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
      .outputText,
    context
  )
}

interface CoordinationHarness {
  engine: EngineProcess
  watcher: MicWatcher
  activity: LibraryActivity
  handles: Array<{ child: ChildProcess; kill: ChildProcess['kill']; closed: boolean }>
  failures: unknown[]
  signals: string[]
  exitStates: Array<{ moving: boolean; closed: boolean }>
  invoke(): void
  mutate(channel: string): Promise<storageApi.StorageResult>
  holdSelection(): void
  resolveSelection(): void
  transferWork(work: () => Promise<void>): void
  naturalExit(): void
  readyCount(): number
  counts(): {
    exits: number
    quits: number
    prevented: number
    schedules: number
    transfers: number
    cancellations: number
    dialogCalls: number
    cleanupCalls: number
    quitting: boolean
  }
}

async function harness(
  t: TestContext,
  options: {
    update?: boolean
    refuse?: boolean
    mic?: boolean
    graceful?: boolean
    engineToo?: boolean
  } = {}
): Promise<CoordinationHarness> {
  const dir = mkdtempSync(join(tmpdir(), 'shutdown-coordination-'))
  const binary = join(dir, 'helper')
  const ready = join(dir, 'ready')
  const release = join(dir, 'release')
  // Controlled natural exit, never an automatic safety timer. No native code.
  writeFileSync(
    binary,
    `#!${process.execPath}
const fs = require('node:fs')
process.on('SIGTERM', () => {})
process.stdin.on('end', () => { if (${options.graceful === true}) process.exit(0) })
process.stdin.resume()
setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) process.exit(0) }, 10)
fs.appendFileSync(${JSON.stringify(ready)}, process.pid + '\\n')
console.log(JSON.stringify({ event: 'status', stage: 'serve_ready' }))
`
  )
  chmodSync(binary, 0o755)
  const handles: Array<{ child: ChildProcess; kill: ChildProcess['kill']; closed: boolean }> = []
  const signals: string[] = []
  const childModule = {
    spawn: (...args: Parameters<typeof spawn>) => {
      const child = spawn(...args)
      const owned = { child, kill: child.kill.bind(child), closed: false }
      child.once('close', () => {
        owned.closed = true
      })
      child.kill = (signal) => {
        signals.push(String(signal))
        return options.refuse ? false : owned.kill(signal)
      }
      handles.push(owned)
      return child
    }
  }
  const Engine = load<{ EngineProcess: typeof EngineProcess }>('engine-process.ts', {
    'node:child_process': childModule
  }).EngineProcess
  const engine = new Engine(binary, 70, 100, 70, 70)
  const Watcher = load<{ MicWatcher: typeof MicWatcher }>('mic-watcher.ts', {
    'node:child_process': childModule
  }).MicWatcher
  const watcher = new Watcher(
    binary,
    dir,
    () => {
      /* no native callbacks */
    },
    () => {
      /* no native callbacks */
    },
    options.engineToo ? 350 : 70,
    70,
    70
  )
  t.after(async () => {
    watcher.stop()
    const disposal = Promise.allSettled([engine.dispose(), watcher.dispose?.()])
    for (const handle of handles) {
      if (!handle.closed) handle.kill('SIGKILL') // exact owned handles, bypass refused test boundary
    }
    await until(() => handles.every((handle) => handle.closed))
    await disposal
    rmSync(dir, { recursive: true, force: true })
  })
  if (options.mic) watcher.start()
  if (!options.mic || options.engineToo) engine.startServe()
  await until(
    () =>
      existsSync(ready) &&
      readFileSync(ready, 'utf8').trim().split('\n').length === (options.engineToo ? 2 : 1)
  )
  const activity = new LibraryActivity()
  const selection = deferred<{ canceled: boolean; filePaths: string[] }>()
  let select = (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    Promise.resolve({ canceled: false, filePaths: ['/synthetic/destination'] })
  let dialogCalls = 0,
    schedules = 0,
    transfers = 0,
    cancellations = 0,
    cleanupCalls = 0
  let transferWork = (): Promise<void> => Promise.resolve()
  const handlers = new Map<string, (event: unknown) => Promise<storageApi.StorageResult>>()
  const storage = {
    root: '/synthetic/original',
    status: () => ({ currentPath: '/synthetic/original', pendingPath: '/synthetic/pending' }),
    schedule: () => {
      schedules++
    },
    finishPending: () => {
      transfers++
      return transferWork()
    },
    cancel: () => {
      cancellations++
    }
  }
  const { registerStorageIpc } = load<typeof import('./storage-service')>('storage-service.ts', {
    electron: {
      ipcMain: {
        handle: (name: string, handler: (event: unknown) => Promise<storageApi.StorageResult>) =>
          handlers.set(name, handler)
      },
      dialog: {
        showOpenDialog: () => {
          dialogCalls++
          return select()
        }
      }
    },
    './library-activity': { libraryActivity: activity },
    './library-storage': {},
    '../shared/storage-api': storageApi
  })
  let hook!: (event: { preventDefault(): void }) => void
  let exits = 0,
    quits = 0,
    prevented = 0
  const failures: unknown[] = []
  const exitStates: Array<{ moving: boolean; closed: boolean }> = []
  const context = {
    ...quitSeam,
    libraryActivity: activity,
    quitting: false,
    engine,
    micWatcher: watcher,
    recordingTray: {
      dispose: () => {
        cleanupCalls++
      }
    },
    calendarService: null,
    isQuittingForUpdate: () => options.update === true,
    app: {
      on: (_name: string, callback: typeof hook) => {
        hook = callback
      },
      quit: () => {
        quits++
        exitStates.push({
          moving: activity.moving,
          closed: handles.every((handle) => handle.closed)
        })
        hook({ preventDefault: () => prevented++ })
      }
    },
    process: {
      exit: () => {
        exits++
        exitStates.push({
          moving: activity.moving,
          closed: handles.every((handle) => handle.closed)
        })
      }
    },
    console: { error: (...args: unknown[]) => failures.push(args.at(-1)) },
    registerStorageIpc,
    storage,
    recording: { busy: false },
    importService: { isBusy: false },
    sourceIndex: {},
    agentAccessService: {}
  }
  register('quit', context)
  register('storage', context)
  return {
    engine,
    watcher,
    activity,
    handles,
    failures,
    signals,
    exitStates,
    invoke: () => hook({ preventDefault: () => prevented++ }),
    mutate: (channel: string) =>
      handlers.get(channel)!({
        sender: {
          isDestroyed: () => false,
          send: () => {
            /* synthetic progress */
          }
        }
      }),
    holdSelection: () => {
      select = () => selection.promise
    },
    resolveSelection: () =>
      selection.resolve({ canceled: false, filePaths: ['/synthetic/destination'] }),
    transferWork: (work: () => Promise<void>) => {
      transferWork = work
    },
    naturalExit: () => writeFileSync(release, ''),
    readyCount: () =>
      existsSync(ready) ? readFileSync(ready, 'utf8').trim().split('\n').length : 0,
    counts: () => ({
      exits,
      quits,
      prevented,
      schedules,
      transfers,
      cancellations,
      dialogCalls,
      cleanupCalls,
      quitting: context.quitting
    })
  }
}

for (const update of [false, true]) {
  test(
    `shutdown excludes new transfer mutations through ${update ? 'updater' : 'ordinary'} completion`,
    { skip: process.platform === 'win32' },
    async (t) => {
      const h = await harness(t, { update })
      h.invoke()
      // Same turn: the shutdown reservation must precede deferred cleanup.
      const change = await h.mutate(storageApi.STORAGE_CHOOSE_CHANNEL)
      const retry = await h.mutate(storageApi.STORAGE_RETRY_CHANNEL)
      const cancel = await h.mutate(storageApi.STORAGE_CANCEL_CHANNEL)
      assert.ok(
        change.error && retry.error && cancel.error,
        'all transfer mutations must reject during shutdown'
      )
      assert.equal(h.counts().schedules + h.counts().transfers + h.counts().cancellations, 0)
      await until(() => h.exitStates.length === 1)
      assert.deepEqual(h.exitStates, [{ moving: false, closed: true }])
      assert.equal(h.counts().exits, update ? 0 : 1)
      assert.equal(h.counts().quits, update ? 1 : 0)
      assert.equal(h.counts().prevented, 1, 'updater continuation is allowed')
    }
  )
}

test(
  'a pending folder selection cannot acquire a transfer lock after shutdown begins',
  { skip: process.platform === 'win32' },
  async (t) => {
    const h = await harness(t)
    h.holdSelection()
    const choosing = h.mutate(storageApi.STORAGE_CHOOSE_CHANNEL)
    assert.equal(h.counts().dialogCalls, 1)
    h.invoke()
    h.resolveSelection()
    assert.ok((await choosing).error, 'late folder selection must be rejected before scheduling')
    assert.equal(h.counts().schedules + h.counts().transfers, 0)
    await until(() => h.exitStates.length === 1)
    assert.deepEqual(h.exitStates, [{ moving: false, closed: true }])
  }
)

test(
  'an admitted transfer owns its lock through failure; retry then quit remain possible',
  { skip: process.platform === 'win32' },
  async (t) => {
    const h = await harness(t)
    const release = deferred()
    h.transferWork(async () => {
      await release.promise
      throw new Error('synthetic copy failure')
    })
    const transfer = h.mutate(storageApi.STORAGE_RETRY_CHANNEL)
    await until(() => h.activity.moving)
    h.invoke()
    await delay(10)
    assert.equal(h.counts().cleanupCalls, 0)
    assert.equal(h.exitStates.length, 0)
    release.resolve()
    assert.ok((await transfer).error)
    h.transferWork(() => Promise.resolve())
    assert.equal((await h.mutate(storageApi.STORAGE_RETRY_CHANNEL)).error, undefined)
    h.invoke()
    await until(() => h.exitStates.length === 1)
    assert.deepEqual(h.exitStates, [{ moving: false, closed: true }])
  }
)

for (const update of [false, true]) {
  test(
    `failed cleanup can retry while live and ${update ? 'update' : 'quit'} after actual late exit`,
    { skip: process.platform === 'win32' },
    async (t) => {
      const h = await harness(t, { refuse: true, update })
      h.invoke()
      h.invoke()
      await until(() => h.failures.length === 1)
      assert.equal(h.exitStates.length, 0)
      assert.equal(h.handles[0].closed, false)
      // Failure releases transfer admission without losing existing pending state.
      assert.equal((await h.mutate(storageApi.STORAGE_RETRY_CHANNEL)).error, undefined)
      h.invoke()
      h.invoke()
      await until(() => h.failures.length === 2)
      assert.equal(h.exitStates.length, 0, 'a still-live helper cannot count as cleanup success')
      assert.equal(h.counts().cleanupCalls, 2, 'one cleanup per explicit attempt')
      assert.deepEqual(h.signals, ['SIGTERM', 'SIGKILL', 'SIGTERM', 'SIGKILL'])
      h.naturalExit()
      await until(() => h.handles.every((handle) => handle.closed))
      h.invoke()
      await until(() => h.exitStates.length === 1)
      assert.deepEqual(h.exitStates, [{ moving: false, closed: true }])
      assert.equal(h.counts().exits, update ? 0 : 1)
      assert.equal(h.counts().quits, update ? 1 : 0)
    }
  )
}

test(
  'production quit waits for an actual stubborn MicWatcher helper',
  { skip: process.platform === 'win32' },
  async (t) => {
    const h = await harness(t, { mic: true })
    h.invoke()
    h.invoke()
    await until(() => h.exitStates.length === 1)
    assert.deepEqual(
      h.exitStates,
      [{ moving: false, closed: true }],
      'micmon must actually close before hard exit'
    )
    h.watcher.start()
    h.watcher.setEnabled(false)
    h.watcher.setEnabled(true)
    await delay(50)
    assert.equal(h.handles.length, 1, 'no relaunch after final disposal')
  }
)

test(
  'late actual child exit allows a later quit after the first shutdown deadline failed',
  { skip: process.platform === 'win32' },
  async (t) => {
    const h = await harness(t, { refuse: true })
    h.invoke()
    await until(() => h.failures.length === 1)
    h.naturalExit()
    await until(() => h.handles.every((handle) => handle.closed))
    assert.equal(
      h.handles[0].child.exitCode,
      0,
      'natural exit observed, not a signal or safety timer'
    )
    h.invoke()
    await until(() => h.exitStates.length === 1)
    assert.deepEqual(h.exitStates, [{ moving: false, closed: true }])
  }
)

test(
  'MicWatcher disposal shares graceful completion and prevents restart',
  { skip: process.platform === 'win32' },
  async (t) => {
    const h = await harness(t, { mic: true, graceful: true })
    const disposal = h.watcher.dispose()
    assert.equal(h.watcher.dispose(), disposal)
    h.invoke()
    await disposal
    await until(() => h.exitStates.length === 1)
    assert.equal(h.handles[0].child.exitCode, 0)
    assert.deepEqual(h.signals, [])
    assert.equal(h.watcher.dispose(), disposal)
    h.watcher.start()
    assert.equal(h.handles.length, 1)
  }
)

test(
  'MicWatcher shutdown retains disabled children as well as a replacement',
  { skip: process.platform === 'win32' },
  async (t) => {
    const h = await harness(t, { mic: true })
    h.watcher.setEnabled(false)
    h.watcher.setAutoStop(false)
    h.watcher.setEnabled(true)
    await until(() => h.readyCount() === 2)
    assert.equal(h.handles[0].closed, false, 'retired monitor has ignored EOF')
    h.invoke()
    await until(() => h.exitStates.length === 1)
    assert.deepEqual(h.exitStates, [{ moving: false, closed: true }])
    assert.equal(h.handles.length, 2)
    assert.deepEqual(h.signals, ['SIGTERM', 'SIGTERM', 'SIGKILL', 'SIGKILL'])
  }
)

test(
  'a retired MicWatcher child exiting cannot detach or restart its replacement',
  { skip: process.platform === 'win32' },
  async (t) => {
    const h = await harness(t, { mic: true })
    h.watcher.setEnabled(false)
    h.watcher.setAutoStop(false)
    h.watcher.setEnabled(true)
    await until(() => h.readyCount() === 2)
    h.handles[0].kill('SIGKILL')
    await until(() => h.handles[0].closed)
    assert.equal(h.watcher.monitorAlive, true)
    h.watcher.start()
    assert.equal(h.handles.length, 2)
    h.invoke()
    await until(() => h.exitStates.length === 1)
    assert.deepEqual(h.exitStates, [{ moving: false, closed: true }])
  }
)

test(
  'MicWatcher failed disposal can complete on a later quit after observed exit',
  { skip: process.platform === 'win32' },
  async (t) => {
    const h = await harness(t, { mic: true, refuse: true, update: true })
    h.invoke()
    h.invoke()
    await until(() => h.failures.length === 1)
    assert.equal(h.exitStates.length, 0)
    h.naturalExit()
    await until(() => h.handles.every((handle) => handle.closed))
    h.invoke()
    await until(() => h.exitStates.length === 1)
    assert.equal(h.counts().quits, 1)
    assert.deepEqual(h.exitStates, [{ moving: false, closed: true }])
  }
)

test(
  'a failed recorder does not release transfer exclusion before monitor cleanup settles',
  { skip: process.platform === 'win32' },
  async (t) => {
    const h = await harness(t, { mic: true, engineToo: true, refuse: true })
    h.invoke()
    await assert.rejects(h.engine.dispose(), /Engine shutdown failed/)
    assert.equal(h.failures.length, 0, 'host must wait for the second owner too')
    assert.ok((await h.mutate(storageApi.STORAGE_RETRY_CHANNEL)).error)
    assert.equal(h.counts().transfers, 0)
    h.naturalExit()
    await until(() => h.handles.every((handle) => handle.closed))
    await until(() => h.failures.length === 1)
    h.invoke()
    await until(() => h.exitStates.length === 1)
    assert.deepEqual(h.exitStates, [{ moving: false, closed: true }])
  }
)
