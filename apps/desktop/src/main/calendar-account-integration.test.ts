import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CryptoProvider,
  ResponseMode,
  type AccountInfo,
  type ICachePlugin,
  type AuthorizationUrlRequest
} from '@azure/msal-node'
import { get, Server } from 'node:http'
import { once } from 'node:events'
import type {
  CalendarState,
  CalendarStartMeetingEvent,
  CalendarEvent
} from '../shared/calendar-api'
import { CalendarAccountStore } from './calendar-account-store'
import { scopeCalendar, scopeEvent } from './calendar-identity'

const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`fixture:${s}`),
  decryptString: (b: Buffer) => b.toString().slice(8)
}
const msAccount = {
  username: 'owner@example.test',
  homeAccountId: 'home',
  localAccountId: 'object',
  tenantId: 'tenant-a',
  environment: 'login.microsoftonline.com',
  name: 'Fixture'
} as AccountInfo
let authorize: () => Promise<void> = async () => {}
let selectedAccount = msAccount
let refresh: () => Promise<void> = async () => {}
class FakeMSAL {
  records: AccountInfo[] = []
  constructor(private options: { cache?: { cachePlugin: ICachePlugin } }) {}
  getTokenCache(): ReturnType<FakeMSAL['cache']> {
    return this.cache()
  }
  private cache(): {
    serialize(): string
    deserialize(s: string): void
    getAllAccounts(): Promise<AccountInfo[]>
    removeAccount(a: AccountInfo): Promise<void>
  } {
    return {
      serialize: () => JSON.stringify(this.records),
      deserialize: (s) => {
        this.records = JSON.parse(s)
      },
      getAllAccounts: async () => {
        await this.before()
        return this.records
      },
      removeAccount: async (a) => {
        this.records = this.records.filter((r) => r !== a)
      }
    }
  }
  private async before(): Promise<void> {
    await this.options.cache?.cachePlugin.beforeCacheAccess({
      tokenCache: this.cache(),
      cacheHasChanged: false
    } as never)
  }
  async acquireTokenSilent(): Promise<{ accessToken: string }> {
    await this.before()
    await refresh()
    await this.options.cache?.cachePlugin.afterCacheAccess({
      tokenCache: this.cache(),
      cacheHasChanged: true
    } as never)
    return { accessToken: 'synthetic-ms-access' }
  }
  async getAuthCodeUrl(request: AuthorizationUrlRequest): Promise<string> {
    const url = new URL(request.redirectUri)
    url.searchParams.set('state', request.state!)
    url.searchParams.set('code', 'synthetic-code')
    return url.href
  }
  async acquireTokenByCode(): Promise<{ accessToken: string; account: AccountInfo }> {
    const account = selectedAccount
    await authorize()
    this.records = [account]
    return { accessToken: 'synthetic-ms-access', account }
  }
}
const rawCalendar = {
  id: 'raw-calendar',
  name: 'Calendar',
  colorHex: '#123456',
  isDefault: true,
  canEdit: false
}
const rawEvent = {
  id: 'raw-event',
  calendarId: rawCalendar.id,
  subject: 'Fixture',
  startIso: '2099-01-01T10:00:00Z',
  endIso: '2099-01-01T11:00:00Z',
  isAllDay: false,
  isOnlineMeeting: false,
  hasParticipants: true
}
class FakeGoogle {
  cancelPending(): void {
    /* This fixture has no browser listener. */
  }
  accountId?: string
  constructor(
    _dir: string,
    _secret: unknown,
    private store: CalendarAccountStore,
    id?: string | null
  ) {
    this.accountId = id === null ? undefined : (id ?? store.entries('google')[0]?.view.id)
  }
  get signedIn(): boolean {
    return !!this.accountId
  }
  get account(): { email: string } | undefined {
    return this.accountId ? this.store.get(this.accountId)?.view : undefined
  }
  async initialize(): Promise<void> {
    /* Fixture identity is already verified. */
  }
  async fetchCalendars(): Promise<ReturnType<typeof scopeCalendar>[]> {
    return [scopeCalendar(this.store.get(this.accountId!)!.identity, rawCalendar)]
  }
  async fetchEvents(): Promise<ReturnType<typeof scopeEvent>[]> {
    return [
      scopeEvent(
        this.store.get(this.accountId!)!.identity,
        (await this.fetchCalendars())[0]!,
        rawEvent
      )
    ]
  }
  disconnect(): void {
    this.store.remove(this.accountId!)
    this.accountId = undefined
  }
}
const fakeShell = {
  openExternal: async (url: string): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      get(url.replace('localhost', '127.0.0.1'), (response) => {
        response.resume()
        response.once('end', resolve)
      }).once('error', reject)
    })
  }
}
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const original = loader._load
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        safeStorage: codec,
        BrowserWindow: { getAllWindows: () => [] },
        shell: fakeShell
      }
    : id === '@azure/msal-node'
      ? { PublicClientApplication: FakeMSAL, CryptoProvider, ResponseMode }
      : id === './google-calendar'
        ? { GoogleCalendarClient: FakeGoogle }
        : original(id, ...args)
const { CalendarService } = require('./calendar-service') as typeof import('./calendar-service')
loader._load = original

type Service = InstanceType<typeof CalendarService> & {
  // Private methods exercised via an isolated test adapter below.
}
interface ServiceAccess {
  rawEvents: CalendarEvent[]
  activePrompt?: CalendarStartMeetingEvent
  ready: Promise<void>
  refreshBusy: boolean
  state(): CalendarState
  connectAccount(provider: 'microsoft' | 'google', id?: string): Promise<CalendarState>
  removeAccount(id: string): Promise<CalendarState>
  cancelAuth(): CalendarState
  connect(): Promise<CalendarState>
  disconnect(): Promise<CalendarState>
  refreshEvents(): Promise<void>
  setPrefs(prefs: { visibleCalendarIds?: string[]; showMenuBar?: boolean }): CalendarState
}
const access = (s: Service): ServiceAccess => s as unknown as ServiceAccess
async function idle(s: Service): Promise<void> {
  await access(s).ready
  for (let i = 0; i < 100 && access(s).refreshBusy; i++)
    await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(access(s).refreshBusy, false)
}
function setup(
  t: TestContext,
  microsoft = [msAccount],
  google = true
): { dir: string; service: Service } {
  const dir = mkdtempSync(join(tmpdir(), 'account-integration-'))
  writeFileSync(join(dir, 'calendar-token-cache'), codec.encryptString(JSON.stringify(microsoft)))
  writeFileSync(
    join(dir, 'calendar-cache.json'),
    JSON.stringify({
      account: { email: msAccount.username },
      calendars: [rawCalendar],
      events: [rawEvent]
    })
  )
  writeFileSync(
    join(dir, 'calendar-settings.json'),
    JSON.stringify({ visibleCalendarIds: [rawCalendar.id] })
  )
  if (google) {
    const store = new CalendarAccountStore(dir, codec)
    store.put(
      { provider: 'google', subject: 'google-subject' },
      { email: 'other@example.test' },
      'fixture',
      true
    )
  }
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert.ok(String(url).startsWith('https://graph.microsoft.com/v1.0/me/'))
    return new Response(
      JSON.stringify(
        String(url).includes('/calendarView?')
          ? {
              value: [
                {
                  id: 'raw-event',
                  subject: 'Fixture',
                  start: { dateTime: rawEvent.startIso },
                  end: { dateTime: rawEvent.endIso },
                  attendees: [{}]
                }
              ]
            }
          : { value: [{ id: rawCalendar.id, name: 'Calendar', isDefaultCalendar: true }] }
      )
    )
  })
  const service = new CalendarService(
    dir,
    () => {},
    () => {}
  )
  t.after(() => {
    service.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return { dir, service }
}

test('single-account migration reaches real service snapshots, selections and recording alias resolution', async (t) => {
  const { dir, service } = setup(t)
  await idle(service)
  const state = access(service).state()
  assert.equal(state.connections?.length, 2)
  assert.equal(state.msSignedIn, true)
  assert.equal(state.googleSignedIn, true)
  assert.equal(state.events.length, 2)
  assert.equal(new Set(state.events.map((e) => e.id)).size, 2)
  const ms = state.events.find((e) => e.provider === 'microsoft')!
  const request: CalendarStartMeetingEvent = {
    action: 'start',
    eventId: ms.id,
    subject: 'Ignore renderer title',
    startIso: ms.startIso
  }
  assert.equal(service.resolveStart(request)?.legacyEventId, rawEvent.id)
  assert.equal(service.resolveStart({ ...request, eventId: 'unowned-event' }), null)
  assert.doesNotMatch(JSON.stringify(state), /synthetic-ms-access|credential|homeAccountId/)
  assert.equal(
    JSON.parse(readFileSync(join(dir, 'calendar-settings.json'), 'utf8')).visibleCalendarIds[0],
    rawCalendar.id
  )
  service.dispose()
  const restarted = new CalendarService(
    dir,
    () => {},
    () => {}
  )
  t.after(() => restarted.dispose())
  await idle(restarted)
  assert.equal(
    access(restarted)
      .state()
      .events.find((e) => e.provider === 'microsoft')!.id,
    ms.id
  )
  assert.equal(restarted.resolveStart(request)?.legacyEventId, rawEvent.id)
})

test('ambiguous legacy MSAL sessions stay disconnected and preserve legacy credentials', async (t) => {
  const { dir, service } = setup(t, [msAccount, { ...msAccount, tenantId: 'tenant-b' }], false)
  await idle(service)
  assert.equal(access(service).state().msSignedIn, false)
  assert.match(access(service).state().error!, /Several legacy/)
  assert.equal(access(service).state().events.length, 0)
  assert.equal(
    JSON.parse(codec.decryptString(readFileSync(join(dir, 'calendar-token-cache')))).length,
    2
  )
})

test('disconnect during a pending refresh cannot restore Microsoft or stop the retained Google connection', async (t) => {
  const { dir, service } = setup(t)
  await idle(service)
  const googleEvent = access(service)
    .state()
    .events.find((e) => e.provider === 'google')!
  access(service).activePrompt = {
    action: 'prompt',
    eventId: googleEvent.id,
    subject: googleEvent.subject,
    startIso: googleEvent.startIso
  }
  let dismissed = false
  t.mock.method(service, 'dismissPrompt', () => {
    dismissed = true
  })
  let release: (value: Response) => void = () => {}
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        release = resolve
      })
  )
  const pending = access(service).refreshEvents()
  await new Promise((resolve) => setTimeout(resolve, 5))
  await access(service).disconnect()
  release(
    new Response(
      JSON.stringify({ value: [{ id: rawCalendar.id, name: 'Calendar', isDefaultCalendar: true }] })
    )
  )
  await pending
  const state = access(service).state()
  assert.equal(state.msSignedIn, false)
  assert.equal(state.googleSignedIn, true)
  assert.equal(dismissed, false, "disconnect must preserve the other account's active prompt")
  assert.ok(state.events.every((e) => e.provider === 'google'))
  assert.equal(new CalendarAccountStore(dir, codec).entries('microsoft').length, 0)
  await access(service).refreshEvents()
  assert.equal(access(service).state().events.length, 1)
})

for (const stage of ['discovery', 'browser', 'token'] as const) {
  for (const stop of ['cancel', 'timeout'] as const) {
    test(`${stop} during Microsoft ${stage} closes callback and fences delayed completion`, async (t) => {
      const { dir, service } = setup(t, [], false)
      await idle(service)
      const entered = deferred<string>()
      const release = deferred()
      const finished = deferred()
      let exchanges = 0
      const getUrl = FakeMSAL.prototype.getAuthCodeUrl
      const exchange = FakeMSAL.prototype.acquireTokenByCode
      let callbackUrl = ''
      t.mock.method(
        FakeMSAL.prototype,
        'getAuthCodeUrl',
        async function (this: FakeMSAL, request: AuthorizationUrlRequest) {
          callbackUrl = request.redirectUri.replace('localhost', '127.0.0.1')
          if (stage === 'discovery') {
            entered.resolve(callbackUrl)
            await release.promise
            finished.resolve()
          }
          return getUrl.call(this, request)
        }
      )
      const browser = fakeShell.openExternal
      t.mock.method(fakeShell, 'openExternal', async (url: string) => {
        if (stage === 'browser') {
          entered.resolve(callbackUrl)
          await release.promise
          finished.resolve()
          // A native browser-open promise can settle after the listener was cancelled.
          return
        }
        await browser(url)
      })
      t.mock.method(FakeMSAL.prototype, 'acquireTokenByCode', async function (this: FakeMSAL) {
        exchanges++
        entered.resolve(callbackUrl)
        await release.promise
        const result = await exchange.call(this)
        finished.resolve()
        return result
      })
      if (stop === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] })
      const pending = access(service).connect()
      const url = await entered.promise
      if (stop === 'timeout') t.mock.timers.tick(5 * 60_000)
      else access(service).cancelAuth()
      const state = await pending
      if (stop === 'timeout') assert.match(state.error!, /timed out/)
      await assert.rejects(
        new Promise((resolve, reject) => get(url, resolve).once('error', reject))
      )
      release.resolve()
      await finished.promise
      await turn()
      assert.equal(exchanges, stage === 'token' ? 1 : 0)
      assert.equal(new CalendarAccountStore(dir, codec).entries().length, 0)
      assert.equal(access(service).state().msSignedIn, false)
      assert.equal(access(service).state().connecting, undefined)
    })
  }
}

test('selection writes survive restart and a failed sync save cannot claim a newer persisted sync', async (t) => {
  const { dir, service } = setup(t)
  await idle(service)
  const google = access(service)
    .state()
    .events.find((e) => e.provider === 'google')!
  access(service).setPrefs({ visibleCalendarIds: [google.calendarId] })
  await idle(service)
  const before = readFileSync(join(dir, 'calendar-accounts-v2'))
  const sync = access(service).state().lastSyncIso
  const encrypt = t.mock.method(codec, 'encryptString', () => {
    throw new Error('fixture disk failure')
  })
  await access(service).refreshEvents()
  assert.match(access(service).state().error!, /Calendar storage/)
  assert.equal(access(service).state().lastSyncIso, sync)
  assert.deepEqual(readFileSync(join(dir, 'calendar-accounts-v2')), before)
  encrypt.mock.restore()
  service.dispose()
  const restarted = new CalendarService(
    dir,
    () => {},
    () => {}
  )
  t.after(() => restarted.dispose())
  await access(restarted).ready
  assert.deepEqual(access(restarted).state().prefs.visibleCalendarIds, [google.calendarId])
  assert.ok(
    access(restarted)
      .state()
      .events.every((e) => e.provider === 'google')
  )
})

test('global menu preferences do not rewrite account selections or require unlocked credentials', async (t) => {
  const { dir, service } = setup(t)
  await idle(service)
  const before = readFileSync(join(dir, 'calendar-accounts-v2'))
  t.mock.method(codec, 'isEncryptionAvailable', () => false)
  const state = access(service).setPrefs({ showMenuBar: false })
  assert.equal(state.prefs.showMenuBar, false)
  assert.equal(state.error, undefined)
  assert.deepEqual(readFileSync(join(dir, 'calendar-accounts-v2')), before)
})

test('adding a second Microsoft tenant preserves selection; duplicate add deduplicates; wrong reconnect and cancelled add preserve both accounts', async (t) => {
  const { dir, service } = setup(t)
  await idle(service)
  const original = access(service)
    .state()
    .connections!.find((c) => c.provider === 'microsoft')!
  const googleCalendar = access(service)
    .state()
    .calendars.find((c) => c.provider === 'google')!
  access(service).setPrefs({ visibleCalendarIds: [googleCalendar.id] })
  await idle(service)
  selectedAccount = {
    ...msAccount,
    tenantId: 'tenant-b',
    localAccountId: 'other-object',
    username: 'second@example.test'
  }
  t.after(() => {
    selectedAccount = msAccount
    authorize = async () => {}
  })
  let state = await access(service).connectAccount('microsoft')
  assert.equal(state.connections?.length, 3)
  assert.equal(state.events.filter((e) => e.provider === 'microsoft').length, 1)
  const second = state.connections!.find((c) => c.email === 'second@example.test')!
  state = await access(service).connectAccount('microsoft')
  assert.equal(state.connections?.length, 3)
  const before = readFileSync(join(dir, 'calendar-accounts-v2'))
  state = await access(service).connectAccount('microsoft', original.id)
  assert.match(state.error!, /targeted Microsoft account/)
  assert.deepEqual(readFileSync(join(dir, 'calendar-accounts-v2')), before)
  let finish: () => void = () => {}
  authorize = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  const pending = access(service).connectAccount('microsoft')
  access(service).cancelAuth()
  finish()
  await pending
  assert.deepEqual(readFileSync(join(dir, 'calendar-accounts-v2')), before)
  await access(service).removeAccount(second.id)
  assert.equal(access(service).state().connections?.length, 2)
  assert.deepEqual(new CalendarAccountStore(dir, codec).get(original.id)?.visibleCalendarIds, [])
})

test('successful Graph refresh removes cancelled meetings', async (t) => {
  const { service } = setup(t, [msAccount], false)
  await idle(service)
  assert.equal(access(service).state().events.length, 1)
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request) =>
      new Response(
        JSON.stringify({
          value: String(url).includes('/calendarView?')
            ? [
                {
                  id: 'raw-event',
                  isCancelled: true,
                  start: { dateTime: rawEvent.startIso },
                  end: { dateTime: rawEvent.endIso }
                }
              ]
            : [{ id: rawCalendar.id, name: 'Calendar', isDefaultCalendar: true }]
        })
      )
  )
  await access(service).refreshEvents()
  assert.equal(access(service).state().events.length, 0)
  assert.equal(access(service).state().error, undefined)
})

test('record-and-join resolves the owning event link and rejects renderer-supplied or unlinked destinations', async (t) => {
  const { service } = setup(t)
  await idle(service)
  const owned = access(service).rawEvents.find((e) => e.provider === 'google')!
  owned.joinUrl = 'https://meet.google.com/aaa-bbbb-ccc'
  const request = {
    action: 'start' as const,
    eventId: owned.id,
    subject: 'wrong title',
    startIso: owned.startIso,
    joinRequested: true,
    joinUrl: 'https://other.example.test/wrong'
  }
  const result = service.resolveStart(request)!
  assert.equal(result.joinUrl, owned.joinUrl)
  assert.equal(result.subject, owned.subject)
  assert.equal(result.joinRequested, true)
  assert.equal(service.resolveStart({ ...request, eventId: '' })?.joinUrl, undefined)
  assert.equal(service.resolveStart({ ...request, eventId: 'missing' }), null)
  owned.joinUrl = 'javascript:alert(1)'
  assert.equal(service.resolveStart(request)?.joinUrl, undefined)
})

test('late token success after removal cannot resurrect the account or interfere with a new reconnect', async (t) => {
  const { dir, service } = setup(t, [msAccount], false)
  await idle(service)
  const id = access(service).state().connections![0]!.id
  const oldEntered = deferred()
  const oldRelease = deferred()
  authorize = async () => {
    oldEntered.resolve()
    await oldRelease.promise
  }
  t.after(() => {
    authorize = async () => {}
    selectedAccount = msAccount
  })
  const old = access(service).connectAccount('microsoft', id)
  await oldEntered.promise
  await access(service).removeAccount(id)
  await old
  assert.equal(new CalendarAccountStore(dir, codec).entries().length, 0)
  const newEntered = deferred()
  const newRelease = deferred()
  selectedAccount = { ...msAccount, name: 'Reconnected fixture' }
  authorize = async () => {
    newEntered.resolve()
    await newRelease.promise
  }
  const fresh = access(service).connectAccount('microsoft')
  await newEntered.promise
  oldRelease.resolve()
  await turn()
  assert.equal(access(service).state().connecting?.provider, 'microsoft')
  assert.equal(access(service).state().msSignedIn, false)
  assert.equal(new CalendarAccountStore(dir, codec).entries().length, 0)
  newRelease.resolve()
  const state = await fresh
  assert.equal(state.connections?.length, 1)
  assert.equal(state.connections?.[0]?.id, id)
  assert.equal(state.connections?.[0]?.name, 'Reconnected fixture')
  assert.equal(new CalendarAccountStore(dir, codec).get(id)?.view.name, 'Reconnected fixture')
})

test('a late silent cache write after reconnect cannot overwrite the new account credential', async (t) => {
  const { dir, service } = setup(t, [msAccount], false)
  await idle(service)
  const id = access(service).state().connections![0]!.id
  const entered = deferred()
  const release = deferred()
  refresh = async () => {
    entered.resolve()
    await release.promise
  }
  t.after(() => {
    refresh = async () => {}
    selectedAccount = msAccount
  })
  const oldRefresh = access(service).refreshEvents()
  await entered.promise
  refresh = async () => {}
  selectedAccount = { ...msAccount, name: 'New credential fixture' }
  const reconnect = access(service).connectAccount('microsoft', id)
  // Authentication commits before waiting for the previous refresh coordinator to drain.
  for (let i = 0; i < 100 && access(service).state().connecting; i++) await turn()
  assert.equal(access(service).state().connecting, undefined)
  const persisted = new CalendarAccountStore(dir, codec).get(id)!
  assert.equal(persisted.view.name, 'New credential fixture')
  release.resolve()
  await oldRefresh
  await reconnect
  assert.equal(new CalendarAccountStore(dir, codec).get(id)?.credential, persisted.credential)
  assert.equal(access(service).state().connections?.[0]?.name, 'New credential fixture')
})

for (const stop of ['cancel', 'timeout'] as const) {
  test(`${stop} while Microsoft callback is binding prevents discovery and closes a late listener`, async (t) => {
    const { dir, service } = setup(t, [], false)
    await idle(service)
    const listen = Server.prototype.listen
    const servers: Server[] = []
    let start!: () => void
    t.mock.method(
      Server.prototype,
      'listen',
      function (this: Server, ...args: Parameters<Server['listen']>) {
        servers.push(this)
        start = () => {
          listen.apply(this, args)
        }
        return this
      }
    )
    const discovery = t.mock.method(FakeMSAL.prototype, 'getAuthCodeUrl')
    const browser = t.mock.method(fakeShell, 'openExternal')
    if (stop === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] })
    const pending = access(service).connect()
    if (stop === 'timeout') t.mock.timers.tick(5 * 60_000)
    else access(service).cancelAuth()
    const state = await pending
    if (stop === 'timeout') assert.match(state.error!, /timed out/)
    const server = servers[0]!
    const listening = once(server, 'listening')
    start()
    await listening
    await turn()
    assert.equal(server.listening, false)
    assert.equal(server.address(), null)
    assert.equal(discovery.mock.callCount(), 0)
    assert.equal(browser.mock.callCount(), 0)
    assert.equal(new CalendarAccountStore(dir, codec).entries().length, 0)
  })
}

test('callback bind failure reaches calendar state without opening the browser or persisting an account', async (t) => {
  const { dir, service } = setup(t, [], false)
  await idle(service)
  t.mock.method(Server.prototype, 'listen', function (this: Server) {
    queueMicrotask(() => this.emit('error', new Error('synthetic bind error')))
    return this
  })
  const browser = t.mock.method(fakeShell, 'openExternal')
  const state = await access(service).connect()
  assert.match(state.error!, /could not open its local callback/)
  assert.equal(state.connecting, undefined)
  assert.equal(browser.mock.callCount(), 0)
  assert.equal(new CalendarAccountStore(dir, codec).entries().length, 0)
})

test('browser-open failure closes the callback and preserves existing account credentials', async (t) => {
  const { dir, service } = setup(t, [msAccount], false)
  await idle(service)
  const before = readFileSync(join(dir, 'calendar-accounts-v2'))
  let callbackUrl = ''
  t.mock.method(fakeShell, 'openExternal', async (url: string) => {
    callbackUrl = url.replace('localhost', '127.0.0.1')
    throw new Error('Synthetic browser could not open')
  })
  const state = await access(service).connect()
  assert.match(state.error!, /Synthetic browser could not open/)
  assert.equal(state.connecting, undefined)
  assert.equal(state.connections?.length, 1)
  await assert.rejects(
    new Promise((resolve, reject) => get(callbackUrl, resolve).once('error', reject))
  )
  assert.deepEqual(readFileSync(join(dir, 'calendar-accounts-v2')), before)
})
