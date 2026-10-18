import { randomUUID } from 'node:crypto'
import { constants, lstatSync, realpathSync, renameSync } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SourceScope } from '@repo/meetings-store/source-contract'
import { localSourceScope, sameScope } from '@repo/meetings-store/sources'
import type { CalendarEvent } from '../shared/calendar-api'
import { readCalendarInvitees } from './calendar-context-normalization'
import type {
  ContextChangeV1,
  ContextEdit,
  ContextEntityV1,
  ContextFileV1,
  EventSnapshotV1
} from './calendar-context-types'
import {
  contextDate,
  contextText,
  foldContext,
  observationDigest,
  contextAccountResolver,
  validateContextFileAsync
} from './calendar-context-validation'
import type { AcceptedCalendarStart } from './calendar-start-context'
import { CalendarContextCodec } from './calendar-context-codec'
import { libraryActivity, type LibraryActivity } from './library-activity'
export type { ContextFileV1, ContextEdit, EventSnapshotV1 } from './calendar-context-types'
export const CONTEXT_FILE = 'calendar-context-v1.json'
export const CONTEXT_MAX_BYTES = 16 * 1024 * 1024
export interface ContextControl {
  assertCurrent(): void
  signal?: AbortSignal
}
type Binding = { root: string; scope: SourceScope }
type Loaded = Binding & { digest: string | null; revision: number; fileToken?: string | null }
const empty = (scope: SourceScope): ContextFileV1 => ({
  version: 1,
  scope,
  revision: 0,
  snapshots: {},
  people: {},
  companies: {},
  changes: []
})

/** One main owner, serialized under the library lease. All identifiers come from trusted main code. */
export class CalendarContextStore {
  private readonly forgetPreviews = new Map<
    string,
    { accountId: string; revision: number; digest: string | null; root: string; expires: number }
  >()
  private readonly codec = new CalendarContextCodec()
  async dispose(): Promise<void> {
    await this.queue
    await this.codec.close()
  }
  private loaded?: Loaded
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly root: () => string,
    private readonly assertAvailable: () => void,
    private readonly activity: LibraryActivity = libraryActivity,
    private readonly io: {
      beforeRename?: () => void
      sync?: (handle: Awaited<ReturnType<typeof open>>) => Promise<void>
    } = {}
  ) {}
  private binding(): Binding {
    this.assertAvailable()
    const root = this.root()
    if (realpathSync(root) !== root || !lstatSync(root).isDirectory())
      throw new Error('Calendar context library path changed.')
    const meetings = join(root, 'meetings')
    if (lstatSync(meetings).isSymbolicLink() || !lstatSync(meetings).isDirectory())
      throw new Error('Calendar context source path is unavailable.')
    const scope = localSourceScope(meetings, false)
    if (
      scope.libraryId.startsWith('legacy-') ||
      scope.accountId !== null ||
      scope.workspaceId !== null
    )
      throw new Error('Calendar context is waiting for canonical source identity.')
    return { root, scope }
  }
  /** Main-only canonical root/scope lifetime. No renderer path or replacement UUID. */
  fence(): Binding & { assertCurrent(): void } {
    const binding = this.binding()
    return { ...binding, assertCurrent: () => this.check(binding, { assertCurrent: () => {} }) }
  }
  private fileToken(binding: Binding): string | null {
    try {
      const stat = lstatSync(join(binding.root, CONTEXT_FILE), { bigint: true })
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Calendar context file changed.')
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  /** Final synchronous admission fence over bytes already decoded and validated by read(). */
  readFence(): () => void {
    const loaded = this.loaded
    if (!loaded || loaded.fileToken === undefined) throw new Error('Read calendar context first.')
    const check = (): void => {
      this.check(loaded, { assertCurrent: () => {} })
      if (this.loaded?.digest !== loaded.digest || this.fileToken(loaded) !== loaded.fileToken)
        throw new Error('Calendar context changed after reading.')
    }
    check()
    return check
  }
  /** Read immediately after read()/capture(); binds consumer previews to exact sidecar bytes. */
  readToken(): string {
    if (!this.loaded) throw new Error('Read calendar context first.')
    this.check(this.loaded, { assertCurrent: () => {} })
    return this.loaded.digest ?? 'absent'
  }
  async changes(
    edits: ContextEdit[],
    revision: number,
    control: ContextControl
  ): Promise<ContextFileV1> {
    if (!Array.isArray(edits) || edits.length < 1 || edits.length > 256)
      throw new Error('Invalid correction batch.')
    const frozen = structuredClone(edits)
    return (
      await this.mutate(revision, control, (data) => {
        for (const edit of frozen) this.append(data, edit)
        return { value: undefined, changed: true }
      })
    ).data
  }
  private check(binding: Binding, control: ContextControl): void {
    control.signal?.throwIfAborted()
    control.assertCurrent()
    const current = this.binding()
    if (current.root !== binding.root || !sameScope(current.scope, binding.scope))
      throw new Error('Calendar context library changed.')
  }
  private serial<T>(control: ContextControl, work: (binding: Binding) => Promise<T>): Promise<T> {
    const binding = this.binding()
    const result = this.queue.then(() =>
      this.activity.run(async () => {
        this.check(binding, control)
        return work(binding)
      }, control.signal)
    )
    this.queue = result.catch(() => {})
    return result
  }
  private async bytes(binding: Binding, control: ContextControl): Promise<Buffer | null> {
    this.check(binding, control)
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(
        join(binding.root, CONTEXT_FILE),
        constants.O_RDONLY | constants.O_NOFOLLOW
      )
    } catch (error) {
      this.check(binding, control)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      this.check(binding, control)
      const stat = await handle.stat()
      this.check(binding, control)
      if (!stat.isFile() || stat.size > CONTEXT_MAX_BYTES)
        throw new Error('Calendar context exceeds capacity or is not a regular file.')
      // Read at most the admission bound even if another process grows the file after stat.
      const buffer = Buffer.alloc(stat.size + 1)
      let count = 0
      while (count < buffer.length) {
        const read = await handle.read(buffer, count, buffer.length - count, count)
        this.check(binding, control)
        if (!read.bytesRead) break
        count += read.bytesRead
      }
      if (count > stat.size) throw new Error('Calendar context changed while reading.')
      return buffer.subarray(0, count)
    } finally {
      await handle.close()
    }
  }
  async read(control: ContextControl): Promise<ContextFileV1> {
    return this.serial(control, async (binding) => {
      const fileToken = this.fileToken(binding)
      const bytes = await this.bytes(binding, control)
      this.check(binding, control)
      const decoded =
        bytes === null
          ? { value: empty(binding.scope), digest: null }
          : await this.codec.decode(bytes)
      this.check(binding, control)
      const data = await validateContextFileAsync(decoded.value, binding.scope, () =>
        this.check(binding, control)
      )
      this.check(binding, control)
      if (this.fileToken(binding) !== fileToken)
        throw new Error('Calendar context changed while reading.')
      this.loaded = { ...binding, digest: decoded.digest, revision: data.revision, fileToken }
      return data
    })
  }
  view(data: ContextFileV1): ReturnType<typeof foldContext> {
    return foldContext(data)
  }
  private async mutate<T>(
    expectedRevision: number,
    control: ContextControl,
    edit: (
      data: ContextFileV1,
      assertCurrent: () => void
    ) => { value: T; changed: boolean } | Promise<{ value: T; changed: boolean }>,
    expectedDigest?: string | null
  ): Promise<{ value: T; data: ContextFileV1 }> {
    return this.serial(control, async (binding) => {
      const bytes = await this.bytes(binding, control)
      this.check(binding, control)
      const decoded =
        bytes === null
          ? { value: empty(binding.scope), digest: null }
          : await this.codec.decode(bytes)
      this.check(binding, control)
      const hash = decoded.digest
      if (expectedDigest !== undefined && expectedDigest !== hash)
        throw new Error('Calendar context changed after preview. Preview again.')
      if (
        this.loaded &&
        (this.loaded.root !== binding.root || !sameScope(this.loaded.scope, binding.scope))
      )
        throw new Error('Calendar context library changed. Read the current library first.')
      if (this.loaded && this.loaded.digest !== hash)
        throw new Error('Calendar context changed externally. Refresh before editing.')
      const data = await validateContextFileAsync(decoded.value, binding.scope, () =>
        this.check(binding, control)
      )
      this.check(binding, control)
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== data.revision)
        throw new Error('Calendar context revision changed. Refresh before editing.')
      const result = await edit(data, () => this.check(binding, control))
      this.check(binding, control)
      if (!result.changed) return { value: result.value, data }
      data.revision++
      await validateContextFileAsync(data, binding.scope, () => this.check(binding, control))
      this.check(binding, control)
      const encoded = await this.codec.encode(data)
      this.check(binding, control)
      const serialized = encoded.serialized
      if (encoded.bytes > CONTEXT_MAX_BYTES)
        throw new Error(
          'Calendar context capacity reached. Use explicit Forget to remove saved account context.'
        )
      const temporary = join(binding.root, `.${CONTEXT_FILE}.${randomUUID()}.tmp`)
      try {
        this.check(binding, control)
        const handle = await open(temporary, 'wx', 0o600)
        try {
          this.check(binding, control)
          await handle.writeFile(serialized)
          this.check(binding, control)
          await (this.io.sync ? this.io.sync(handle) : handle.sync())
          this.check(binding, control)
        } finally {
          await handle.close()
        }
        this.check(binding, control)
        const verify = await open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const copy = await verify.readFile('utf8')
          this.check(binding, control)
          if (copy !== serialized)
            throw new Error('Calendar context temporary verification failed.')
          // Exact bytes equal the already schema-validated encoded document.
        } finally {
          await verify.close()
        }
        const latest = await this.bytes(binding, control)
        this.check(binding, control)
        const latestDigest = latest === null ? null : await this.codec.hash(latest)
        this.check(binding, control)
        if (latestDigest !== hash)
          throw new Error('Calendar context changed externally before commit.')
        this.io.beforeRename?.()
        // No JS suspension between final lifetime check, atomic publication and revision publish.
        this.check(binding, control)
        renameSync(temporary, join(binding.root, CONTEXT_FILE))
        this.loaded = {
          ...binding,
          digest: encoded.digest,
          revision: data.revision
        }
        return { value: result.value, data }
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
    })
  }
  private append(
    data: ContextFileV1,
    payload: ContextEdit,
    provenance: ContextChangeV1['provenance'] = 'user',
    supersedes: string | null = null
  ): ContextChangeV1 {
    const change: ContextChangeV1 = {
      id: randomUUID(),
      revision: data.revision + 1,
      at: new Date().toISOString(),
      supersedes,
      provenance,
      payload: structuredClone(payload)
    }
    data.changes.push(change)
    return change
  }
  async capture(
    event: CalendarEvent,
    lastSyncIso: string | null,
    expectedRevision: number,
    control: ContextControl
  ): Promise<{ snapshot: EventSnapshotV1; revision: number }> {
    // Freeze the input before waiting for queue/lease admission.
    const frozen = structuredClone(event)
    const roster = readCalendarInvitees(frozen.invitees)
    const fields = {
      eventId: frozen.id,
      accountId: frozen.accountId!,
      calendarId: frozen.calendarId,
      provider: frozen.provider!,
      providerEventId: frozen.providerEventId!,
      occurrenceId: frozen.occurrenceId!,
      subject: Array.from(frozen.subject.replace(/\p{Cc}/gu, ''))
        .slice(0, 256)
        .join(''),
      startIso: frozen.startIso,
      endIso: frozen.endIso,
      roster: roster.roster,
      invitees: roster.entries
    }
    const eventDigest = observationDigest(fields)
    const result = await this.mutate(expectedRevision, control, async (data, assertCurrent) => {
      const previous = Object.values(data.snapshots)
        .filter((s) => s.eventId === fields.eventId && s.accountId === fields.accountId)
        .at(-1)
      // Reuse only the current observation. A→B→A is a new observation carrying B's
      // latest corrections; reusing historical A would resurrect superseded assignments.
      if (previous?.eventDigest === eventDigest) return { value: previous, changed: false }
      if (lastSyncIso !== null && !contextDate(lastSyncIso))
        throw new Error('Calendar context sync date is invalid.')
      const snapshot: EventSnapshotV1 = {
        id: randomUUID(),
        ...fields,
        eventDigest,
        observedAt: new Date().toISOString(),
        calendarLastSyncIso: lastSyncIso,
        calendarWasStale: frozen.stale === true
      }
      const view = foldContext(data)
      data.snapshots[snapshot.id] = snapshot
      // Validate the new observation before deriving any concrete user/rule bindings.
      await validateContextFileAsync(data, data.scope, assertCurrent)
      for (const invitee of snapshot.invitees) {
        if (!invitee.identifierKey || invitee.roles.includes('resource')) continue
        const previousInvitee = previous?.invitees.find(
          (i) => i.identifierKey === invitee.identifierKey
        )
        const override =
          previousInvitee && previous ? view.bindings[previous.id]?.[previousInvitee.id] : undefined
        const origin = override ? data.changes.find((c) => c.id === override.changeId) : undefined
        const rule = data.changes
          .filter(
            (c) =>
              c.payload.op === 'set-rule' &&
              c.payload.accountId === snapshot.accountId &&
              c.payload.identifierKey === invitee.identifierKey
          )
          .at(-1)
        const personId =
          origin?.provenance === 'user'
            ? override!.personId
            : rule?.payload.op === 'set-rule'
              ? rule.payload.personId
              : undefined
        const excluded =
          personId &&
          data.changes.some(
            (c) =>
              c.payload.op === 'exclude-person' &&
              c.payload.eventId === snapshot.eventId &&
              c.payload.identifierKey === invitee.identifierKey &&
              c.payload.personId === personId
          )
        if (personId !== undefined)
          this.append(
            data,
            {
              op: 'bind-invitee',
              snapshotId: snapshot.id,
              inviteeId: invitee.id,
              personId: excluded ? null : personId
            },
            origin?.provenance === 'user' ? 'user' : 'confirmed-rule',
            origin?.provenance === 'user' ? origin.id : null
          )
        if (
          previousInvitee &&
          previous &&
          typeof view.self[previous.id]?.[previousInvitee.id] === 'boolean'
        ) {
          const prior = data.changes
            .filter(
              (c) =>
                c.payload.op === 'set-self' &&
                c.payload.snapshotId === previous.id &&
                c.payload.inviteeId === previousInvitee.id
            )
            .at(-1)!
          this.append(
            data,
            {
              op: 'set-self',
              snapshotId: snapshot.id,
              inviteeId: invitee.id,
              isSelf: view.self[previous.id]![previousInvitee.id]!
            },
            'user',
            prior.id
          )
        }
      }
      return { value: snapshot, changed: true }
    })
    return { snapshot: structuredClone(result.value), revision: result.data.revision }
  }
  async createEntity(
    kind: 'person' | 'company',
    accountId: string,
    displayName: string,
    revision: number,
    control: ContextControl
  ): Promise<{ entity: ContextEntityV1; revision: number }> {
    const result = await this.mutate(revision, control, (data) => {
      if (
        !['person', 'company'].includes(kind) ||
        !contextText(displayName, 256) ||
        !displayName.trim() ||
        !Object.values(data.snapshots).some((s) => s.accountId === accountId)
      )
        throw new Error('Calendar context entity account/name is invalid.')
      const entity = {
        id: randomUUID(),
        accountId,
        displayName: displayName.trim(),
        createdAt: new Date().toISOString()
      }
      data[kind === 'person' ? 'people' : 'companies'][entity.id] = entity
      return { value: entity, changed: true }
    })
    return { entity: result.value, revision: result.data.revision }
  }
  async change(
    edit: ContextEdit,
    revision: number,
    control: ContextControl
  ): Promise<ContextFileV1> {
    const frozen = structuredClone(edit)
    return (
      await this.mutate(revision, control, (data) => {
        this.append(data, frozen)
        return { value: undefined, changed: true }
      })
    ).data
  }
  /** Main validates the exact previewed IDs and binds them to an expected revision. */
  async applyHistoricalBindings(
    bindings: Array<{ snapshotId: string; inviteeId: string; personId: string | null }>,
    revision: number,
    control: ContextControl
  ): Promise<ContextFileV1> {
    if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 256)
      throw new Error('Narrow the calendar correction to 256 invitees.')
    const frozen = structuredClone(bindings)
    return (
      await this.mutate(revision, control, (data) => {
        const keys = new Set<string>()
        for (const binding of frozen) {
          const key = JSON.stringify([binding.snapshotId, binding.inviteeId])
          if (keys.has(key)) throw new Error('Duplicate calendar correction reference.')
          keys.add(key)
          this.append(data, { op: 'bind-invitee', ...binding })
        }
        return { value: undefined, changed: true }
      })
    ).data
  }
  /** Main-only accepted capture adapter; this never writes or normalizes an original. */
  async recordAcceptedStart(start: AcceptedCalendarStart, control: ContextControl): Promise<void> {
    const frozen = structuredClone(start)
    const binding = this.binding()
    this.check(binding, control)
    if (
      !sameScope(frozen.original.scope, binding.scope) ||
      frozen.original.trashed ||
      frozen.original.calendarEventId !== frozen.event.id
    )
      throw new Error('Calendar start original scope/event is unavailable.')
    const data = await this.read(control)
    this.check(binding, control)
    const captured = await this.capture(frozen.event, frozen.lastSyncIso, data.revision, control)
    this.check(binding, control)
    // Existing originals require explicit review. In particular, never replace a Resume snapshot.
    if (frozen.existedAtAttach) return
    await this.mutate(captured.revision, control, (next) => {
      const existing = foldContext(next).links.some(
        (c) =>
          c.payload.meetingId === frozen.original.meetingId &&
          c.payload.target.kind === 'event' &&
          c.payload.target.eventId === frozen.event.id &&
          c.payload.target.accountId === frozen.event.accountId
      )
      if (existing) return { value: undefined, changed: false }
      this.append(
        next,
        {
          op: 'link-meeting',
          meetingId: frozen.original.meetingId,
          target: {
            kind: 'event',
            accountId: captured.snapshot.accountId,
            eventId: frozen.event.id
          },
          snapshotId: captured.snapshot.id,
          sourceRevisionAtLink: frozen.original.projectedRevisionId,
          originalHashAtLink: frozen.original.rawSha256,
          companyIdAtLink: null
        },
        'accepted-start'
      )
      return { value: undefined, changed: true }
    })
    this.check(binding, control)
  }
  async previewForget(
    accountId: string,
    control: ContextControl
  ): Promise<{
    previewId: string
    revision: number
    snapshots: number
    people: number
    companies: number
    changes: number
  }> {
    const data = await this.read(control)
    if (!this.loaded || this.loaded.revision !== data.revision)
      throw new Error('Calendar context changed during preview.')
    if (!/^cal2:account:[a-f0-9]{64}$/.test(accountId))
      throw new Error('Calendar account is invalid.')
    const previewId = randomUUID()
    while (this.forgetPreviews.size >= 16)
      this.forgetPreviews.delete(this.forgetPreviews.keys().next().value!)
    this.forgetPreviews.set(previewId, {
      accountId,
      revision: data.revision,
      digest: this.loaded.digest,
      root: this.loaded.root,
      expires: Date.now() + 120_000
    })
    return {
      previewId,
      revision: data.revision,
      snapshots: Object.values(data.snapshots).filter((s) => s.accountId === accountId).length,
      people: Object.values(data.people).filter((p) => p.accountId === accountId).length,
      companies: Object.values(data.companies).filter((p) => p.accountId === accountId).length,
      changes: (() => {
        const account = this.accountResolver(data)
        return data.changes.filter((c) => account(c) === accountId).length
      })()
    }
  }
  private accountResolver(data: ContextFileV1): (c: ContextChangeV1) => string {
    const targetAccount = contextAccountResolver(data)
    const changes = new Map(data.changes.map((c) => [c.id, c]))
    const account = (c: ContextChangeV1): string => {
      const p = c.payload
      if (p.op === 'bind-invitee' || p.op === 'set-self')
        return data.snapshots[p.snapshotId]!.accountId
      if (p.op === 'set-rule') return p.accountId
      if (p.op === 'set-company' || p.op === 'exclude-person')
        return data.people[p.personId]!.accountId
      if (p.op === 'link-meeting') return targetAccount(p.target)
      if (p.op === 'unlink-meeting') return account(changes.get(p.linkChangeId)!)
      return data[p.entity === 'person' ? 'people' : 'companies'][p.id]!.accountId
    }
    return account
  }
  async forget(
    accountId: string,
    revision: number,
    control: ContextControl,
    previewId: string
  ): Promise<ContextFileV1> {
    const preview = this.forgetPreviews.get(previewId)
    this.forgetPreviews.delete(previewId)
    if (
      !preview ||
      preview.accountId !== accountId ||
      preview.revision !== revision ||
      preview.root !== this.root() ||
      preview.expires < Date.now()
    )
      throw new Error('Calendar context forget preview/revision changed. Preview again.')
    return (
      await this.mutate(
        revision,
        control,
        (data) => {
          if (!/^cal2:account:[a-f0-9]{64}$/.test(accountId))
            throw new Error('Calendar context account is invalid.')
          const account = this.accountResolver(data)
          data.changes = data.changes.filter((c) => account(c) !== accountId)
          for (const map of [data.snapshots, data.people, data.companies])
            for (const [id, item] of Object.entries(map))
              if (item.accountId === accountId) delete map[id]
          return { value: undefined, changed: true }
        },
        preview.digest
      )
    ).data
  }
}
