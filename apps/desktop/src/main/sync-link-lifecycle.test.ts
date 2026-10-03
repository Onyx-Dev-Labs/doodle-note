import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SyncStatus } from '../shared/sync-api'
import type { MeetingsService } from './meetings-service'
import type { FoldersService } from './folders-service'

// Load the real service with only Electron's OS boundary replaced. No live tokens or network.
const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
let openBrowser: (url: string) => Promise<void> = async () => {}
const encrypted: string[] = []
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        shell: { openExternal: (url: string) => openBrowser(url) },
        safeStorage: {
          encryptString: (value: string) => {
            encrypted.push(value)
            return Buffer.from(value)
          },
          decryptString: (value: Buffer) => value.toString()
        }
      }
    : originalLoad(id, ...args)
const { SyncService } = require('./sync-service') as typeof import('./sync-service')
loader._load = originalLoad

const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
function setup(t: TestContext): {
  service: InstanceType<typeof SyncService>
  events: SyncStatus[]
  dir: string
  cycles: () => number
} {
  const dir = mkdtempSync(join(tmpdir(), 'sync-link-test-'))
  const events: SyncStatus[] = []
  let cycles = 0
  const service = new SyncService(
    dir,
    { readAll: () => [] } as unknown as MeetingsService,
    { list: () => [] } as unknown as FoldersService,
    (_channel, payload) => {
      events.push(payload as SyncStatus)
    }
  )
  // Upload behavior itself is unchanged and covered separately; fail closed at this boundary.
  Object.assign(service, {
    syncCycle: async () => {
      cycles++
    }
  })
  encrypted.length = 0
  t.after(() => {
    service.cancelConnect()
    rmSync(dir, { recursive: true, force: true })
  })
  return { service, events, dir, cycles: () => cycles }
}
function callback(url: string): string {
  return `http://127.0.0.1:${new URL(url).searchParams.get('port')}/callback?token=dnsy_fixture&email=qa%40example.test`
}

test('duplicate connect uses one listener; cancelled old continuation cannot retire retry', async (t) => {
  const { service, events, cycles } = setup(t)
  const urls: string[] = []
  openBrowser = async (url) => {
    urls.push(url)
  }
  const old = service.connect()
  assert.equal((await service.connect()).linking, true)
  while (!urls.length) await turn()
  assert.equal(urls.length, 1)
  assert.equal(service.cancelConnect().linking, false)
  const next = service.connect()
  await old
  assert.equal(service.status().linking, true)
  while (urls.length < 2) await turn()
  await assert.rejects(fetch(callback(urls[0]!)))
  assert.equal(encrypted.length, 0)
  assert.equal(cycles(), 0)
  const response = await fetch(callback(urls[1]!), { redirect: 'manual' })
  assert.equal(response.status, 302)
  const final = await next
  assert.equal(final.connected, true)
  assert.equal(final.linking, false)
  assert.equal(final.enabled, true)
  assert.equal(encrypted.length, 1)
  assert.equal(cycles(), 1)
  assert.equal(events.at(-1)?.connected, true)
  assert.equal(events.at(-1)?.linking, false)
  assert.ok(
    events.every((event, i) => i === 0 || event.statusRevision > events[i - 1]!.statusRevision)
  )
})

test('cancelling an unfinished reconnect preserves encrypted account/config and local notes', async (t) => {
  const { service, dir, cycles } = setup(t)
  const config = {
    tokenEnc: Buffer.from('dnsy_existing_fixture').toString('base64'),
    email: 'existing@example.test',
    enabled: false
  }
  Object.assign(service, { config: { ...Reflect.get(service, 'config'), ...config } })
  writeFileSync(join(dir, 'sync.json'), JSON.stringify(config))
  writeFileSync(join(dir, 'notes-fixture.txt'), 'Local fixture note')
  const before = readFileSync(join(dir, 'sync.json'), 'utf8')
  openBrowser = () => new Promise(() => {})
  const attempt = service.connect()
  const cancelled = service.cancelConnect()
  await attempt
  assert.equal(cancelled.connected, true)
  assert.equal(cancelled.enabled, false)
  assert.equal(cancelled.email, config.email)
  assert.equal(readFileSync(join(dir, 'sync.json'), 'utf8'), before)
  assert.equal(readFileSync(join(dir, 'notes-fixture.txt'), 'utf8'), 'Local fixture note')
  assert.equal(cycles(), 0)
  assert.equal(encrypted.length, 0)
})

test('disconnect retires pending authorization and late browser failures cannot change retry status', async (t) => {
  const { service } = setup(t)
  let rejectOld!: (error: Error) => void
  openBrowser = () =>
    new Promise((_resolve, reject) => {
      rejectOld = reject
    })
  const old = service.connect()
  while (!rejectOld) await turn()
  service.disconnect()
  openBrowser = async () => {}
  const next = service.connect()
  rejectOld(new Error('private fixture error'))
  await old
  await turn()
  assert.equal(service.status().linking, true)
  assert.equal(service.status().connected, false)
  assert.equal(service.status().lastError, undefined)
  service.cancelConnect()
  await next
})

test('launch failure clears main-process linking and broadcasts a recoverable sanitized error', async (t) => {
  const { service, events } = setup(t)
  openBrowser = async () => {
    throw new Error('private fixture')
  }
  const result = await service.connect()
  assert.equal(result.linking, false)
  assert.equal(result.connected, false)
  assert.match(result.lastError!, /Could not open your browser/)
  assert.doesNotMatch(JSON.stringify(events), /private fixture/)
})
