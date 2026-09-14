import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  CalendarConnection,
  CalendarEvent,
  CalendarInfo,
  CalendarProvider
} from '../shared/calendar-api'
import { accountKey, scopeCalendar, scopeEvent, type CalendarIdentity } from './calendar-identity'

export interface CalendarEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

/** Private main-process persistence. Do not send this shape through IPC. */
export interface StoredCalendarConnection {
  identity: CalendarIdentity
  view: CalendarConnection
  credential: string
  calendars: CalendarInfo[]
  events: CalendarEvent[]
  visibleCalendarIds: string[] | null
  notified: Record<string, string>
  lastSyncIso?: string
}

interface CalendarVault {
  version: 2
  accounts: Record<string, StoredCalendarConnection>
  legacyDone: Partial<Record<CalendarProvider, boolean>>
  /** Ambiguities are permanent. Removal must not reassign old notes. */
  aliases: Record<string, string | null>
}

const storageError = (): Error =>
  new Error(
    'Calendar storage could not be saved or unlocked. Check your keychain and disk, then restart DoodleNote. Your existing data has been preserved.'
  )

export class CalendarAccountStore {
  private data: CalendarVault = { version: 2, accounts: {}, legacyDone: {}, aliases: {} }
  private epochs = new Map<string, number>()
  readonly path: string
  readonly error?: string

  constructor(
    userData: string,
    private readonly encryption: CalendarEncryption
  ) {
    this.path = join(userData, 'calendar-accounts-v2')
    try {
      if (
        !encryption.isEncryptionAvailable() &&
        ['calendar-accounts-v2', 'calendar-token-cache', 'google-token-cache'].some((file) =>
          existsSync(join(userData, file))
        )
      )
        throw storageError()
      if (existsSync(this.path)) {
        if (!encryption.isEncryptionAvailable()) throw storageError()
        const raw = JSON.parse(encryption.decryptString(readFileSync(this.path))) as CalendarVault
        if (raw.version !== 2 || !raw.accounts || !raw.legacyDone || !raw.aliases)
          throw storageError()
        for (const [id, entry] of Object.entries(raw.accounts)) {
          if (
            id !== accountKey(entry.identity) ||
            entry.view.id !== id ||
            entry.view.provider !== entry.identity.provider ||
            typeof entry.view.email !== 'string' ||
            typeof entry.credential !== 'string' ||
            !Array.isArray(entry.events) ||
            !Array.isArray(entry.calendars) ||
            !entry.notified ||
            !(entry.visibleCalendarIds === null || Array.isArray(entry.visibleCalendarIds))
          )
            throw storageError()
          if (
            entry.calendars.some((c) => c.accountId !== id) ||
            entry.events.some((e) => e.accountId !== id)
          )
            throw storageError()
        }
        this.data = raw
      }
    } catch {
      this.error = storageError().message
    }
  }

  views(): CalendarConnection[] {
    return Object.values(this.data.accounts).map(({ view }) => ({
      id: view.id,
      provider: view.provider,
      email: view.email,
      ...(view.name ? { name: view.name } : {})
    }))
  }

  assertWritable(): void {
    if (this.error || !this.encryption.isEncryptionAvailable()) throw storageError()
  }
  entries(provider?: CalendarProvider): StoredCalendarConnection[] {
    return structuredClone(
      Object.values(this.data.accounts).filter((e) => !provider || e.identity.provider === provider)
    )
  }
  get(id: string): StoredCalendarConnection | undefined {
    return structuredClone(this.data.accounts[id])
  }
  migrated(provider: CalendarProvider): boolean {
    return this.data.legacyDone[provider] === true
  }
  epoch(id: string): number {
    return this.epochs.get(id) ?? 0
  }
  current(id: string, epoch: number): boolean {
    return !!this.data.accounts[id] && this.epoch(id) === epoch
  }

  put(
    identity: CalendarIdentity,
    view: { email: string; name?: string },
    credential: string,
    finishLegacy = false
  ): string {
    const id = accountKey(identity)
    this.commit((next) => {
      const old = next.accounts[id]
      next.accounts[id] = {
        ...(old ?? { calendars: [], events: [], visibleCalendarIds: null, notified: {} }),
        identity,
        view: { ...view, id, provider: identity.provider },
        credential
      }
      if (finishLegacy) next.legacyDone[identity.provider] = true
    })
    this.epochs.set(id, this.epoch(id) + 1)
    return id
  }

  update(id: string, epoch: number, change: (entry: StoredCalendarConnection) => void): boolean {
    if (!this.current(id, epoch)) return false
    this.commit((next) => change(next.accounts[id]!))
    return true
  }

  remove(id: string): void {
    const entry = this.data.accounts[id]
    if (!entry) return
    this.commit((next) => {
      delete next.accounts[id]
      next.legacyDone[entry.identity.provider] = true
    })
    this.epochs.set(id, this.epoch(id) + 1)
  }

  /** Mark even a discarded ambiguous legacy source, so it can never resurrect. */
  finishLegacy(provider: CalendarProvider): void {
    if (!this.migrated(provider))
      this.commit((next) => {
        next.legacyDone[provider] = true
      })
  }

  /** Import only after credential ownership was authenticated. No email matching. */
  migrateSnapshot(
    id: string,
    calendars: CalendarInfo[],
    events: CalendarEvent[],
    visible: string[] | null,
    notified: Record<string, string>,
    lastSyncIso?: string
  ): void {
    const entry = this.data.accounts[id]
    if (!entry || this.migrated(entry.identity.provider)) return
    this.commit((next) => {
      const target = next.accounts[id]!
      const scoped = calendars.map((c) => scopeCalendar(entry.identity, c))
      const mapping = new Map(calendars.map((c, i) => [c.id, scoped[i]!]))
      const imported: CalendarEvent[] = []
      for (const event of events) {
        const calendar = mapping.get(event.calendarId)
        if (!calendar) continue // legacy entries without a known calendar are ambiguous
        const normalized = scopeEvent(entry.identity, calendar, event)
        const previous = next.aliases[event.id]
        next.aliases[event.id] =
          previous === undefined || previous === normalized.id ? normalized.id : null
        imported.push(normalized)
        if (notified[event.id]) target.notified[normalized.id] = notified[event.id]!
      }
      target.calendars = scoped
      target.events = imported
      target.visibleCalendarIds =
        visible === null ? null : visible.flatMap((old) => mapping.get(old)?.id ?? [])
      target.lastSyncIso = lastSyncIso
      next.legacyDone[entry.identity.provider] = true
    })
  }

  legacyAlias(eventId: string): string | undefined {
    const matches = Object.entries(this.data.aliases).filter(([, id]) => id === eventId)
    return matches.length === 1 ? matches[0]![0] : undefined
  }

  setSelection(ids: string[] | null, activeIds: string[]): void {
    this.commit((next) => {
      for (const id of activeIds) {
        const entry = next.accounts[id]
        if (entry)
          entry.visibleCalendarIds =
            ids === null
              ? null
              : ids.filter(
                  (key) =>
                    entry.calendars.some((c) => c.id === key) ||
                    entry.visibleCalendarIds?.includes(key)
                )
      }
    })
  }

  private commit(change: (next: CalendarVault) => void): void {
    this.assertWritable()
    const next = structuredClone(this.data)
    change(next)
    const temp = `${this.path}.${randomUUID()}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const serialized = JSON.stringify(next)
      writeFileSync(temp, this.encryption.encryptString(serialized), { mode: 0o600, flag: 'wx' })
      // Windows FlushFileBuffers requires a handle opened for writing.
      const fd = openSync(temp, 'r+')
      try {
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      if (this.encryption.decryptString(readFileSync(temp)) !== serialized) throw storageError()
      renameSync(temp, this.path)
      this.data = JSON.parse(serialized) as CalendarVault
    } catch {
      throw storageError()
    } finally {
      rmSync(temp, { force: true })
    }
  }
}
