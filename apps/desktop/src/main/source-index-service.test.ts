import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SourceSearchResult, SourceResolution } from '@repo/meetings-store/source-contract'
import { LibraryStorage } from './library-storage'
import type { StorageResult } from '../shared/storage-api'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
let picked = { canceled: true, filePaths: [] as string[] }
const workers: TestWorker[] = []
let liveWorkers = 0
let peakWorkers = 0
const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const original = loader._load
// Only Electron transport and the emitted worker entry path are replaced. The real
// service, client, worker, storage, IPC and library-operation barrier run together.
class TestWorker extends Worker {
  holdResponses = false
  held: unknown[][] = []
  retirementGate?: Promise<void>
  override emit(name: string | symbol, ...args: unknown[]): boolean {
    if (name === 'message' && this.holdResponses && !(args[0] as { ready?: boolean }).ready) {
      this.held.push(args)
      super.emit('response-held')
      return true
    }
    return super.emit(name, ...args)
  }
  releaseResponses(): void {
    this.holdResponses = false
    for (const args of this.held.splice(0)) super.emit('message', ...args)
  }
  override async terminate(): Promise<number> {
    await this.retirementGate
    return super.terminate()
  }
  constructor(_path: string, options: WorkerOptions) {
    super(
      `require(${JSON.stringify(require.resolve('tsx/cjs'))}); require(${JSON.stringify(require.resolve('@repo/meetings-store/source-index-worker'))});`,
      { ...options, eval: true }
    )
    workers.push(this)
    peakWorkers = Math.max(peakWorkers, ++liveWorkers)
    this.once('exit', () => liveWorkers--)
  }
}
loader._load = (id, ...args) => {
  if (id === 'electron')
    return {
      ipcMain: {
        handle: (name: string, callback: (...args: unknown[]) => unknown) =>
          handlers.set(name, callback)
      },
      dialog: { showOpenDialog: async () => picked }
    }
  if (id === 'node:worker_threads') return { Worker: TestWorker }
  return original(id, ...args)
}
const { SourceIndexService } =
  require('./source-index-service') as typeof import('./source-index-service')
const { registerStorageIpc } = require('./storage-service') as typeof import('./storage-service')
loader._load = original

const event = { sender: { isDestroyed: () => false, send: () => {} } }
const call = <T>(name: string, ...args: unknown[]): Promise<T> =>
  Promise.resolve(handlers.get(name)!(event, ...args) as T)

function fixture(
  t: test.TestContext,
  io?: ConstructorParameters<typeof LibraryStorage>[1]
): {
  root: string
  profile: string
  destination: string
  storage: LibraryStorage
  service: InstanceType<typeof SourceIndexService>
  put: (text: string) => void
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'doodle-source-service-')))
  const profile = join(root, 'profile'),
    destination = join(root, 'destination')
  mkdirSync(join(profile, 'meetings'), { recursive: true })
  mkdirSync(destination)
  const storage = new LibraryStorage(profile, io)
  const put = (text: string): void =>
    writeFileSync(
      join(storage.root, 'meetings/a.json'),
      JSON.stringify({ id: 'a', rawNotesMarkdown: text })
    )
  put('original needle')
  peakWorkers = liveWorkers
  // This live getter is the same contract used by the other library services.
  const service = new SourceIndexService(
    () => join(storage.root, 'meetings'),
    join(profile, 'cache'),
    storage.assertAvailable
  )
  service.registerIpc()
  registerStorageIpc(
    storage,
    () => false,
    () => service.refreshLibraryPath()
  )
  t.after(async () => {
    await service.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, profile, destination, storage, service, put }
}

test('live storage IPC relocation rebinds the worker; edits resolve only against active originals', async (t) => {
  const f = fixture(t)
  const before = await call<SourceSearchResult>('sources:search', 'needle')
  const anchor = before.hits[0]!.anchor
  const originalBytes = readFileSync(join(f.profile, 'meetings/a.json'))
  picked = { canceled: false, filePaths: [f.destination] }
  const moved = await call<StorageResult>('storage:choose')
  assert.equal(moved.error, undefined)
  assert.notEqual(f.storage.root, f.profile)
  assert.equal((await call<SourceResolution>('sources:resolve', anchor)).status, 'resolved')
  f.put('replacement')
  f.service.invalidate()
  const [old, fresh, resolution] = await Promise.all([
    call<SourceSearchResult>('sources:search', 'needle'),
    call<SourceSearchResult>('sources:search', 'replacement'),
    call<SourceResolution>('sources:resolve', anchor)
  ])
  assert.equal(old.hits.length, 0)
  assert.equal(fresh.hits.length, 1)
  assert.equal(fresh.countsAreComplete, true)
  assert.equal(resolution.status, 'stale')
  assert.equal(peakWorkers, 1, 'replacement worker starts only after the previous writer exits')
  assert.deepEqual(readFileSync(join(f.profile, 'meetings/a.json')), originalBytes)
  assert.match(readFileSync(join(f.storage.root, 'meetings/a.json'), 'utf8'), /replacement/)
  renameSync(f.storage.root, f.storage.root + '-disconnected')
  await assert.rejects(call('sources:search', 'needle'), /unavailable/)
  await assert.rejects(call('sources:resolve', anchor), /unavailable/)
  assert.deepEqual(readFileSync(join(f.profile, 'meetings/a.json')), originalBytes)
})

test('pending search/resolve, queued rebind requests and late messages are fenced across relocation and cancellation', async (t) => {
  const f = fixture(t)
  const anchor = (await call<SourceSearchResult>('sources:search', 'needle')).hits[0]!.anchor
  const oldWorker = workers.at(-1)!
  oldWorker.holdResponses = true
  const searchHeld = once(oldWorker, 'response-held')
  const oldSearch = call('sources:search', 'needle')
  const searchRejected = assert.rejects(oldSearch, /scope or content changed/)
  await searchHeld
  const resolveHeld = once(oldWorker, 'response-held')
  const oldResolve = call('sources:resolve', anchor)
  const resolveRejected = assert.rejects(oldResolve, /scope or content changed/)
  await resolveHeld
  let retire!: () => void
  oldWorker.retirementGate = new Promise<void>((resolve) => {
    retire = resolve
  })
  try {
    // Simulate an out-of-band trusted root change as well as the normal IPC path
    // covered above. Responses produced for the old root are deliberately delayed.
    f.storage.schedule(f.destination)
    await f.storage.finishPending()
    f.service.refreshLibraryPath()
    await Promise.all([searchRejected, resolveRejected])
    f.put('replacement')
    const waiting = call('sources:search', 'replacement')
    const waitingRejected = assert.rejects(waiting, /scope or content changed/)
    await call('sources:cancel')
    await waitingRejected // cancellation must not wait for worker termination
    assert.equal(liveWorkers, 1)
    assert.equal(workers.at(-1), oldWorker)
    oldWorker.releaseResponses()
    retire()
    const replacement = await call<SourceSearchResult>('sources:search', 'replacement')
    assert.equal(replacement.hits.length, 1)
    assert.equal((await call<SourceResolution>('sources:resolve', anchor)).status, 'stale')
    assert.equal(peakWorkers, 1)
    // Also fence a response from the new client rather than only the retired one.
    const currentWorker = workers.at(-1)!
    currentWorker.holdResponses = true
    const currentHeld = once(currentWorker, 'response-held')
    const pending = call('sources:search', 'replacement')
    const pendingRejected = assert.rejects(pending, /scope or content changed/)
    await currentHeld
    await call('sources:cancel')
    await pendingRejected
    currentWorker.releaseResponses()
    assert.equal((await call<SourceSearchResult>('sources:search', 'replacement')).hits.length, 1)
  } finally {
    retire()
  }
})

test('cancelled and failed transfers preserve the active library; unannounced path changes never use the old copy', async (t) => {
  let failCopy = true
  const { copyFile } = await import('node:fs/promises')
  const f = fixture(t, {
    copyFile: async (...args) => {
      if (failCopy) throw new Error('synthetic copy failure')
      await copyFile(...args)
    }
  })
  const anchor = (await call<SourceSearchResult>('sources:search', 'needle')).hits[0]!.anchor
  const firstWorker = workers.at(-1)
  picked = { canceled: true, filePaths: [] }
  assert.equal((await call<StorageResult>('storage:choose')).error, undefined)
  picked = { canceled: false, filePaths: [f.destination] }
  assert.match((await call<StorageResult>('storage:choose')).error!, /synthetic copy failure/)
  assert.equal(f.storage.root, f.profile)
  assert.equal((await call<SourceResolution>('sources:resolve', anchor)).status, 'resolved')
  assert.equal(workers.at(-1), firstWorker)
  assert.equal((await call<StorageResult>('storage:cancel')).error, undefined)
  failCopy = false
  f.storage.schedule(f.destination)
  await f.storage.finishPending() // intentionally omit callback: live getter still detects switch
  f.put('replacement')
  assert.equal((await call<SourceSearchResult>('sources:search', 'needle')).hits.length, 0)
  assert.equal((await call<SourceSearchResult>('sources:search', 'replacement')).hits.length, 1)
  assert.equal(peakWorkers, 1)
})
