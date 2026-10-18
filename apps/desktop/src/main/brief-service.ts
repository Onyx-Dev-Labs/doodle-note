import { createHash, randomUUID } from 'node:crypto'
import { sameScope } from '@repo/meetings-store/sources'
import type { EvidenceMeetingMeta } from '@repo/meetings-store/evidence-contract'
import type {
  BriefEdit,
  BriefLinkTarget,
  BriefPreview,
  BriefSelection,
  BriefView,
  BriefResult,
  BriefForgetPreview
} from '../shared/briefs-api'
import type { CitationView, CitedAskRequest } from '../shared/cited-ask-api'
import type { CitedAskService, AskControl } from './cited-ask-service'
import { CalendarContextStore } from './calendar-context-store'
import type { ContextFileV1, ContextEdit, EventSnapshotV1 } from './calendar-context-types'
import { contextObject, contextText, contextUuid, foldContext } from './calendar-context-validation'
import type { TrustedCalendarObservation, CalendarLinkedOriginal } from './calendar-start-context'
import { briefLinks, briefPeople } from './brief-history'

type Original = CalendarLinkedOriginal & EvidenceMeetingMeta
export interface BriefDependencies {
  store: CalendarContextStore
  cited: CitedAskService
  calendar: {
    resolveBrief(eventId: string): TrustedCalendarObservation | null
    subscribeBrief(listener: () => void): () => void
  }
  /** Trusted metadata nomination. CitedAskService remains the final original/citation authority. */
  originals: {
    get(id: string, control: AskControl): Promise<Original | null>
    list(query: string, control: AskControl): Promise<EvidenceMeetingMeta[]>
    assertCurrent(original: Original): void
  }
  publish(ownerId: string, view: BriefView): void
}
type Request = Extract<CitedAskRequest, { purpose: 'calendar-brief' }>
type Operation = { id: string; abort: AbortController; done: Promise<void> }
type Session = {
  id: string
  owner: string
  eventId: string
  fence: ReturnType<CalendarContextStore['fence']>
  selection: BriefSelection
  view: BriefView
  operation?: Operation
}
type Resolved = { data: ContextFileV1; snapshot: EventSnapshotV1; token: string; request: Request }
const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(v)
const error = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code })
}
const checkedKeys = (value: unknown, allowed: string[]): Record<string, unknown> => {
  if (!contextObject(value) || Object.keys(value).some((k) => !allowed.includes(k)))
    return error('invalid-subset', 'Invalid brief request.')
  return value
}

/** One session owner per window, no renderer-supplied scope, inference engine or durable answers. */
export class BriefService {
  private sessions = new Map<string, Session>()
  private cache = new Map<string, { result: BriefResult; bytes: number }>()
  private cacheBytes = 0
  private disposed = false
  private closing = false
  private ownerOpen = new Map<string, number>()
  private readonly unsubscribe: () => void
  private previews = new Map<
    string,
    {
      session: string
      token: string
      revision: number
      expires: number
      bindings: Array<{ snapshotId: string; inviteeId: string; personId: string | null }>
    }
  >()
  constructor(private readonly deps: BriefDependencies) {
    this.unsubscribe = deps.calendar.subscribeBrief(() => {
      void this.invalidate().catch(() => {})
    })
  }
  private session(owner: string, sessionId: string): Session {
    const s = this.sessions.get(sessionId)
    if (this.disposed || !s || s.owner !== owner)
      return error('unauthorized', 'Brief session owner is unavailable.')
    return s
  }
  private emit(s: Session, view: BriefView): BriefView {
    if (this.sessions.get(s.id) !== s || this.disposed)
      return { sessionId: s.id, state: 'unavailable', message: 'Brief unavailable.' }
    s.view = view
    try {
      this.deps.publish(s.owner, structuredClone(view))
    } catch {
      /* Window teardown cannot retain a producer. */
    }
    return structuredClone(view)
  }
  private hide(s: Session, state: BriefView['state'], message: string): BriefView {
    return this.emit(s, { sessionId: s.id, state, message })
  }
  /** Synchronous admission revocation; producer cleanup continues through the shared cancel API. */
  async invalidate(): Promise<void> {
    this.cache.clear()
    this.cacheBytes = 0
    this.previews.clear()
    const draining: Promise<unknown>[] = []
    for (const s of this.sessions.values()) {
      s.operation?.abort.abort()
      this.hide(s, 'stale', 'Local context changed. Refresh to check it again.')
      if (s.operation)
        draining.push(this.deps.cited.cancel(this.ownerKey(s), s.operation.id), s.operation.done)
    }
    await Promise.all(draining)
  }
  async refreshAll(): Promise<void> {
    await this.invalidate()
    await Promise.all(
      [...this.sessions.values()].map((s) => this.refresh(s.owner, s.id).catch(() => {}))
    )
  }
  private ownerKey(s: Session): string {
    return `brief:${s.owner}:${s.id}`
  }
  private async work(
    s: Session,
    runId: string,
    action: (control: AskControl) => Promise<BriefView>
  ): Promise<BriefView> {
    if (s.operation)
      return {
        sessionId: s.id,
        state: 'error',
        errorCode: 'busy',
        message: 'Wait for the current brief operation to finish.'
      }
    let finish!: () => void
    const op: Operation = {
      id: runId,
      abort: new AbortController(),
      done: new Promise<void>((resolve) => {
        finish = resolve
      })
    }
    s.operation = op
    const check = (): void => {
      op.abort.signal.throwIfAborted()
      if (this.disposed || this.closing || this.sessions.get(s.id) !== s || s.operation !== op)
        error('unauthorized', 'Brief owner changed.')
      s.fence.assertCurrent()
    }
    const control: AskControl = {
      ownerId: this.ownerKey(s),
      runId,
      signal: op.abort.signal,
      assertCurrent: check,
      onProgress: (phase) => {
        check()
        const safe = { ...s.view }
        delete safe.result
        this.emit(s, { ...safe, state: phase, runId })
      }
    }
    try {
      check()
      return await action(control)
    } catch (e) {
      if (this.sessions.get(s.id) !== s || this.disposed)
        return { sessionId: s.id, state: 'unavailable', message: 'Brief closed.' }
      if (op.abort.signal.aborted)
        return this.hide(s, 'cancelled', 'Brief cancelled. Refresh to review current context.')
      const code = contextObject(e) && typeof e.code === 'string' ? e.code : 'unavailable'
      if (code === 'invalid-subset' || code === 'narrow-history') {
        const safe = { ...s.view }
        delete safe.result
        return this.emit(s, {
          ...safe,
          state: 'error',
          errorCode: code,
          message: e instanceof Error ? e.message : 'Invalid history selection.'
        })
      }
      return this.hide(
        s,
        'unavailable',
        'Calendar or local history is unavailable. Refresh to check again.'
      )
    } finally {
      if (s.operation === op) s.operation = undefined
      finish()
    }
  }
  private selection(value: BriefSelection): BriefSelection {
    const v = checkedKeys(value, ['meetingIds', 'includeCompany', 'topic'])
    if (
      v.meetingIds !== undefined &&
      (!Array.isArray(v.meetingIds) ||
        v.meetingIds.length > 4096 ||
        v.meetingIds.some((x) => !id(x)))
    )
      error('invalid-subset', 'Invalid linked history selection.')
    if (v.includeCompany !== undefined && typeof v.includeCompany !== 'boolean')
      error('invalid-subset', 'Invalid company selection.')
    if (v.topic !== undefined && !contextText(v.topic, 1024))
      error('invalid-subset', 'Topic must be at most 1024 characters.')
    return {
      ...(v.meetingIds !== undefined
        ? { meetingIds: [...new Set(v.meetingIds as string[])].sort() }
        : {}),
      includeCompany: v.includeCompany === true,
      ...(typeof v.topic === 'string' && v.topic.trim() ? { topic: v.topic.trim() } : {})
    }
  }
  private async resolve(
    s: Session,
    control: AskControl,
    show: boolean,
    expectedRevision?: number
  ): Promise<Resolved> {
    control.assertCurrent()
    const observation = this.deps.calendar.resolveBrief(s.eventId)
    if (!observation) return error('unauthorized', 'Calendar event unavailable.')
    const assertCurrent = (): void => {
      control.assertCurrent()
      observation.assertCurrent()
    }
    assertCurrent()
    const local = { signal: control.signal, assertCurrent }
    let data = await this.deps.store.read(local)
    assertCurrent()
    if (expectedRevision !== undefined && data.revision !== expectedRevision)
      error('stale', 'Calendar context revision changed.')
    const captured = await this.deps.store.capture(
      observation.event,
      observation.lastSyncIso,
      data.revision,
      local
    )
    assertCurrent()
    data = await this.deps.store.read(local)
    assertCurrent()
    if (data.revision !== captured.revision) error('stale', 'Calendar context changed.')
    const token = this.deps.store.readToken()
    const snapshot = data.snapshots[captured.snapshot.id]!
    const folded = foldContext(data)
    const links = briefLinks(data, folded, snapshot, s.selection.includeCompany === true)
    const linkedIds = [...new Set(links.map((c) => c.payload.meetingId))].sort()
    const selected = s.selection.meetingIds ?? linkedIds
    if (selected.some((i) => !linkedIds.includes(i)))
      error('invalid-subset', 'Select meetings from the current linked history only.')
    // Membership is retained even when an original is missing or unavailable. Never manufacture [].
    const history: NonNullable<BriefView['history']> = []
    const inspect = [...new Set([...selected.slice(0, 256), ...linkedIds.slice(0, 256)])]
    for (const meetingId of inspect) {
      const original = await this.deps.originals.get(meetingId, control)
      assertCurrent()
      const related = links.filter((c) => c.payload.meetingId === meetingId)
      const available =
        !!original &&
        !original.trashed &&
        sameScope(original.scope, data.scope) &&
        !related.some(
          (c) =>
            c.provenance === 'accepted-start' &&
            c.payload.target.kind === 'event' &&
            original.calendarEventId !== c.payload.target.eventId
        )
      if (original && available) this.deps.originals.assertCurrent(original)
      if (selected.includes(meetingId) && !available)
        error('unavailable', 'Some linked history could not be checked.')
      history.push({
        meetingId,
        title: available ? original!.title : 'Unavailable linked meeting',
        occurredAt: available ? original!.occurredAt : null,
        dateBasis: available ? original!.dateBasis : 'unknown',
        available,
        linkIds: related.map((c) => c.id),
        provenance: [
          ...new Set(
            related.map((c) =>
              c.provenance === 'accepted-start' ? 'Captured calendar observation' : 'Linked by you'
            )
          )
        ]
      })
    }
    assertCurrent()
    const people = briefPeople(data, folded, snapshot)
    const eventText = JSON.stringify({
      title: snapshot.subject,
      start: snapshot.startIso,
      end: snapshot.endIso,
      people: people
        .filter((p) => p.personId && p.isSelf !== true && !p.roles.includes('resource'))
        .map((p) => p.personName)
        .slice(0, 32)
    })
    const request: Request = {
      purpose: 'calendar-brief',
      selection: {
        mode: 'linked-history',
        meetingIds: selected,
        ...(s.selection.topic ? { topic: s.selection.topic } : {})
      },
      context: { templateVersion: 1, eventText },
      consumerRevision: sha({
        root: s.fence.root,
        scope: data.scope,
        token,
        event: snapshot.eventDigest,
        selection: s.selection
      })
    }
    if (show)
      this.emit(s, {
        sessionId: s.id,
        state: linkedIds.length ? 'review-ready' : 'no-history',
        revision: data.revision,
        event: {
          id: s.eventId,
          subject: snapshot.subject,
          startIso: snapshot.startIso,
          endIso: snapshot.endIso,
          provider: snapshot.provider,
          sourceLabel: observation.event.sourceLabel ?? 'Connected calendar',
          lastSyncIso: observation.lastSyncIso,
          stale: observation.event.stale === true,
          roster: snapshot.roster
        },
        people,
        personChoices: Object.values(data.people)
          .filter((p) => p.accountId === snapshot.accountId)
          .map((p) => ({ id: p.id, name: folded.names[p.id] ?? p.displayName })),
        companyChoices: Object.values(data.companies)
          .filter((p) => p.accountId === snapshot.accountId)
          .map((p) => ({ id: p.id, name: folded.names[p.id] ?? p.displayName })),
        history,
        historyTotal: linkedIds.length,
        selectedMeetingIds: selected,
        includeCompany: s.selection.includeCompany === true
      })
    // Carry the trusted event fence through every later await in this operation.
    const previous = control.assertCurrent
    control.assertCurrent = () => {
      previous()
      observation.assertCurrent()
    }
    return { data, snapshot, token, request }
  }
  async open(owner: string, eventId: string): Promise<BriefView> {
    if (
      this.disposed ||
      !owner ||
      typeof eventId !== 'string' ||
      !/^cal2:event:[a-f0-9]{64}$/.test(eventId)
    )
      error('unauthorized', 'Invalid brief owner/event.')
    const opening = (this.ownerOpen.get(owner) ?? 0) + 1
    this.ownerOpen.set(owner, opening)
    await this.closeOwner(owner, true)
    if (this.disposed || this.closing || this.ownerOpen.get(owner) !== opening)
      error('unauthorized', 'Brief open superseded.')
    if (this.sessions.size >= 16) error('busy', 'Close another brief first.')
    const sessionId = randomUUID()
    const s: Session = {
      id: sessionId,
      owner,
      eventId,
      fence: this.deps.store.fence(),
      selection: { includeCompany: false },
      view: { sessionId, state: 'checking' }
    }
    this.sessions.set(s.id, s)
    return this.refresh(owner, s.id)
  }
  async select(owner: string, sessionId: string, selection: BriefSelection): Promise<BriefView> {
    const s = this.session(owner, sessionId)
    if (s.operation) await this.cancel(owner, sessionId, s.operation.id)
    const validated = this.selection(selection)
    s.selection = validated
    return this.refresh(owner, sessionId)
  }
  async refresh(owner: string, sessionId: string): Promise<BriefView> {
    const s = this.session(owner, sessionId)
    if (s.operation) await this.cancel(owner, sessionId, s.operation.id)
    this.hide(s, 'checking', 'Checking local context…')
    return this.work(s, randomUUID(), async (control) => {
      const current = await this.resolve(s, control, true)
      control.assertCurrent()
      const key = sha(current.request)
      const cached = this.cache.get(key)
      if (cached) await this.admit(s, cached.result, current, control, false)
      return structuredClone(s.view)
    })
  }
  private async admit(
    s: Session,
    result: BriefResult,
    prior: Resolved,
    control: AskControl,
    cache: boolean
  ): Promise<void> {
    control.assertCurrent()
    const current = await this.resolve(s, control, false)
    control.assertCurrent()
    if (sha(prior.request) !== sha(current.request)) error('stale', 'Brief context changed.')
    // Empty and insufficient snapshots follow exactly the same current-request validation path.
    if (!result.snapshot.evidence.coverage.scanComplete)
      error('unavailable', 'History scan is incomplete.')
    const validation = await this.deps.cited.validate(result.snapshot, current.request, control)
    control.assertCurrent()
    if (validation.status !== 'valid') error(validation.status, validation.reason)
    const final = await this.resolve(s, control, false)
    control.assertCurrent()
    if (sha(final.request) !== sha(current.request))
      error('stale', 'Brief context changed during validation.')
    if (cache || this.cache.has(sha(final.request))) this.remember(sha(final.request), result)
    this.emit(s, {
      ...s.view,
      state: result.status === 'no-history' ? 'no-history' : 'ready',
      result,
      runId: control.runId
    })
  }
  private remember(key: string, result: BriefResult): void {
    const bytes = Buffer.byteLength(JSON.stringify(result))
    if (bytes > 1024 * 1024) return
    const old = this.cache.get(key)
    if (old) this.cacheBytes -= old.bytes
    this.cache.delete(key)
    while (this.cache.size >= 16 || this.cacheBytes + bytes > 1024 * 1024) {
      const oldest = this.cache.keys().next().value!
      this.cacheBytes -= this.cache.get(oldest)!.bytes
      this.cache.delete(oldest)
    }
    this.cache.set(key, { result, bytes })
    this.cacheBytes += bytes
  }
  async generate(
    owner: string,
    sessionId: string,
    runId: string,
    selection: BriefSelection
  ): Promise<BriefView> {
    const s = this.session(owner, sessionId)
    if (!id(runId)) error('invalid-subset', 'Invalid brief run.')
    return this.work(s, runId, async (control) => {
      s.selection = this.selection(selection)
      const current = await this.resolve(s, control, true)
      control.assertCurrent()
      const result = await this.deps.cited.run(current.request, control)
      control.assertCurrent()
      if (result.status === 'error')
        return this.emit(s, {
          ...s.view,
          state: 'error',
          errorCode: result.code,
          message: result.message,
          runId
        })
      await this.admit(s, result, current, control, true)
      control.assertCurrent()
      return structuredClone(s.view)
    })
  }
  async cancel(owner: string, sessionId: string, runId: string): Promise<void> {
    const s = this.session(owner, sessionId)
    const op = s.operation
    if (!op || op.id !== runId) return
    op.abort.abort()
    this.hide(s, 'cancelling', 'Cancelling local work…')
    await this.deps.cited.cancel(this.ownerKey(s), runId)
    await op.done
  }
  async close(owner: string, sessionId: string): Promise<void> {
    const s = this.session(owner, sessionId)
    const op = s.operation
    this.sessions.delete(s.id)
    for (const [key, p] of this.previews) if (p.session === s.id) this.previews.delete(key)
    if (op) {
      op.abort.abort()
      await this.deps.cited.cancel(this.ownerKey(s), op.id)
      await op.done
    }
  }
  async closeOwner(owner: string, keepOpening = false): Promise<void> {
    if (!keepOpening) this.ownerOpen.set(owner, (this.ownerOpen.get(owner) ?? 0) + 1)
    await Promise.all(
      [...this.sessions.values()]
        .filter((s) => s.owner === owner)
        .map((s) => this.close(owner, s.id))
    )
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.closing = true
    this.unsubscribe()
    const owners = [...new Set([...this.sessions.values()].map((s) => s.owner))]
    await Promise.all(owners.map((owner) => this.closeOwner(owner)))
    this.disposed = true
    this.cache.clear()
    this.cacheBytes = 0
    this.previews.clear()
  }
  async citation(owner: string, sessionId: string, evidenceId: string): Promise<CitationView> {
    const s = this.session(owner, sessionId)
    const result = s.view.result
    if (!result || typeof evidenceId !== 'string' || evidenceId.length > 200)
      return { status: 'missing', reason: 'Refresh and generate the brief first.' }
    let citation: CitationView = { status: 'unavailable', reason: 'Brief is unavailable.' }
    await this.work(s, randomUUID(), async (control) => {
      const current = await this.resolve(s, control, false)
      control.assertCurrent()
      const resolved = await this.deps.cited.resolveCitation(
        result.snapshot,
        evidenceId,
        current.request,
        control
      )
      control.assertCurrent()
      citation = resolved
      if (citation.status !== 'resolved')
        this.hide(s, 'stale', 'Original changed. Refresh the brief.')
      return structuredClone(s.view)
    })
    return citation
  }
  private async editWork(
    owner: string,
    sessionId: string,
    revision: number,
    action: (s: Session, r: Resolved, c: AskControl) => Promise<void>
  ): Promise<BriefView> {
    const s = this.session(owner, sessionId)
    if (!Number.isSafeInteger(revision) || revision < 0) error('stale', 'Invalid context revision.')
    if (s.operation) await this.cancel(owner, sessionId, s.operation.id)
    return this.work(s, randomUUID(), async (c) => {
      const r = await this.resolve(s, c, true, revision)
      c.assertCurrent()
      if (r.data.revision !== revision) error('stale', 'Refresh before correcting a changed event.')
      await action(s, r, c)
      c.assertCurrent()
      this.cache.clear()
      this.cacheBytes = 0
      s.selection = { includeCompany: s.selection.includeCompany }
      await this.resolve(s, c, true)
      c.assertCurrent()
      return structuredClone(s.view)
    })
  }
  private entity(r: Resolved, kind: 'person' | 'company', entityId: string): void {
    const map = kind === 'person' ? r.data.people : r.data.companies
    if (
      !contextUuid(entityId) ||
      !Object.hasOwn(map, entityId) ||
      map[entityId]!.accountId !== r.snapshot.accountId
    )
      error('unauthorized', 'Context entity belongs to another account.')
  }
  async edit(
    owner: string,
    sessionId: string,
    revision: number,
    change: BriefEdit
  ): Promise<BriefView> {
    return this.editWork(owner, sessionId, revision, async (_s, r, c) => {
      if (!contextObject(change)) error('invalid-subset', 'Invalid correction.')
      const edits: ContextEdit[] = []
      if (change.op === 'create-person' || change.op === 'create-company') {
        checkedKeys(change, ['op', 'name'])
        if (!contextText(change.name, 256) || !change.name.trim())
          error('invalid-subset', 'Enter a local name.')
        await this.deps.store.createEntity(
          change.op === 'create-person' ? 'person' : 'company',
          r.snapshot.accountId,
          change.name,
          revision,
          c
        )
        c.assertCurrent()
        return
      }
      if (change.op === 'bind' || change.op === 'exclude' || change.op === 'self') {
        checkedKeys(
          change,
          change.op === 'bind'
            ? ['op', 'inviteeId', 'personId', 'future']
            : change.op === 'self'
              ? ['op', 'inviteeId', 'isSelf']
              : ['op', 'inviteeId', 'personId']
        )
        const invitee = r.snapshot.invitees.find((i) => i.id === change.inviteeId)
        if (!invitee) error('unauthorized', 'Invitee unavailable.')
        if (change.op === 'self') {
          if (typeof change.isSelf !== 'boolean')
            error('invalid-subset', 'Invalid self correction.')
          edits.push({
            op: 'set-self',
            snapshotId: r.snapshot.id,
            inviteeId: invitee!.id,
            isSelf: change.isSelf
          })
        } else {
          if (change.personId !== null) this.entity(r, 'person', change.personId)
          if (change.op === 'bind') {
            if (typeof change.future !== 'boolean')
              error('invalid-subset', 'Invalid correction scope.')
            edits.push({
              op: 'bind-invitee',
              snapshotId: r.snapshot.id,
              inviteeId: invitee!.id,
              personId: change.personId
            })
            if (change.future) {
              if (!invitee!.identifierKey)
                error(
                  'invalid-subset',
                  'This ambiguous invitee cannot define a future identity rule.'
                )
              edits.push({
                op: 'set-rule',
                accountId: r.snapshot.accountId,
                identifierKey: invitee!.identifierKey!,
                personId: change.personId
              })
            }
          } else {
            if (!invitee!.identifierKey) error('invalid-subset', 'No exact identity to exclude.')
            edits.push({
              op: 'exclude-person',
              eventId: r.snapshot.eventId,
              identifierKey: invitee!.identifierKey!,
              personId: change.personId
            })
          }
        }
      } else if (change.op === 'company') {
        checkedKeys(change, ['op', 'personId', 'companyId'])
        this.entity(r, 'person', change.personId)
        if (change.companyId !== null) this.entity(r, 'company', change.companyId)
        edits.push({ op: 'set-company', personId: change.personId, companyId: change.companyId })
      } else if (change.op === 'rename') {
        checkedKeys(change, ['op', 'entity', 'id', 'name'])
        if (change.entity !== 'person' && change.entity !== 'company')
          error('invalid-subset', 'Invalid entity type.')
        this.entity(r, change.entity, change.id)
        edits.push({ op: 'rename', entity: change.entity, id: change.id, displayName: change.name })
      } else if (change.op === 'unlink') {
        checkedKeys(change, ['op', 'linkId'])
        const link = briefLinks(r.data, foldContext(r.data), r.snapshot, true).find(
          (l) => l.id === change.linkId
        )
        if (!link) error('unauthorized', 'History link unavailable.')
        edits.push({ op: 'unlink-meeting', linkChangeId: change.linkId })
      } else error('invalid-subset', 'Unsupported correction.')
      await this.deps.store.changes(edits, revision, c)
      c.assertCurrent()
    })
  }
  async candidates(
    owner: string,
    sessionId: string,
    query: string
  ): Promise<EvidenceMeetingMeta[]> {
    const s = this.session(owner, sessionId)
    if (!contextText(query, 256)) error('invalid-subset', 'Narrow the local search.')
    let candidates: EvidenceMeetingMeta[] = []
    await this.work(s, randomUUID(), async (c) => {
      await this.resolve(s, c, false)
      c.assertCurrent()
      const found = await this.deps.originals.list(query, c)
      c.assertCurrent()
      candidates = found
      return structuredClone(s.view)
    })
    return candidates.slice(0, 50)
  }
  async link(
    owner: string,
    sessionId: string,
    revision: number,
    meetingId: string,
    target: BriefLinkTarget
  ): Promise<BriefView> {
    if (!id(meetingId)) error('invalid-subset', 'Invalid original identity.')
    return this.editWork(owner, sessionId, revision, async (_s, r, c) => {
      checkedKeys(
        target,
        target?.kind === 'event'
          ? ['kind']
          : target?.kind === 'person'
            ? ['kind', 'personId']
            : ['kind', 'companyId']
      )
      const original = await this.deps.originals.get(meetingId, c)
      c.assertCurrent()
      if (!original || original.trashed || !sameScope(original.scope, r.data.scope))
        error('unauthorized', 'Original unavailable in this library.')
      this.deps.originals.assertCurrent(original!)
      const folded = foldContext(r.data)
      const sameEvent = original!.calendarEventId === r.snapshot.eventId
      // Explicit event-only cross-calendar association is allowed; people never cross account provenance.
      if (target.kind !== 'event' && original!.calendarEventId && !sameEvent)
        error('unauthorized', 'Use an event-only link for another calendar connection.')
      let saved: Extract<ContextEdit, { op: 'link-meeting' }>['target']
      let companyIdAtLink: string | null = null
      if (target.kind === 'event')
        saved = { kind: 'event', accountId: r.snapshot.accountId, eventId: r.snapshot.eventId }
      else if (target.kind === 'person') {
        this.entity(r, 'person', target.personId)
        saved = target
        companyIdAtLink = folded.companies[target.personId] ?? null
      } else if (target.kind === 'company') {
        this.entity(r, 'company', target.companyId)
        saved = target
        companyIdAtLink = target.companyId
      } else return error('invalid-subset', 'Invalid history target.')
      await this.deps.store.change(
        {
          op: 'link-meeting',
          meetingId,
          target: saved,
          snapshotId: null,
          sourceRevisionAtLink: original!.projectedRevisionId,
          originalHashAtLink: original!.rawSha256,
          companyIdAtLink
        },
        revision,
        {
          signal: c.signal,
          assertCurrent: () => {
            c.assertCurrent()
            this.deps.originals.assertCurrent(original!)
          }
        }
      )
      c.assertCurrent()
    })
  }
  async previewHistory(
    owner: string,
    sessionId: string,
    revision: number,
    inviteeId: string,
    personId: string | null
  ): Promise<BriefPreview> {
    const s = this.session(owner, sessionId)
    let preview: BriefPreview | undefined
    await this.work(s, randomUUID(), async (c) => {
      const r = await this.resolve(s, c, false, revision)
      c.assertCurrent()
      if (personId !== null) this.entity(r, 'person', personId)
      const invitee = r.snapshot.invitees.find((i) => i.id === inviteeId)
      if (!invitee?.identifierKey) error('invalid-subset', 'Exact observed identity required.')
      const matches = Object.values(r.data.snapshots)
        .filter((old) => old.accountId === r.snapshot.accountId)
        .flatMap((old) =>
          old.invitees
            .filter((i) => i.identifierKey === invitee!.identifierKey)
            .map((i) => ({ snapshotId: old.id, inviteeId: i.id, personId, date: old.startIso }))
        )
      if (!matches.length || matches.length > 256)
        error('narrow-history', 'Narrow the historical correction to 256 invitees.')
      while (this.previews.size >= 16) this.previews.delete(this.previews.keys().next().value!)
      const previewId = randomUUID()
      this.previews.set(previewId, {
        session: s.id,
        token: r.token,
        revision: r.data.revision,
        expires: Date.now() + 120000,
        bindings: matches.map((b) => ({
          snapshotId: b.snapshotId,
          inviteeId: b.inviteeId,
          personId: b.personId
        }))
      })
      const dates = matches.map((m) => m.date).sort()
      preview = {
        previewId,
        revision: r.data.revision,
        count: matches.length,
        firstDate: dates[0]!,
        lastDate: dates.at(-1)!
      }
      return structuredClone(s.view)
    })
    if (!preview) error('unavailable', 'Historical preview unavailable.')
    return preview!
  }
  async applyHistory(owner: string, sessionId: string, previewId: string): Promise<BriefView> {
    const s = this.session(owner, sessionId)
    const p = this.previews.get(previewId)
    this.previews.delete(previewId)
    if (!p || p.session !== s.id || p.expires < Date.now())
      error('stale', 'Preview expired. Review again.')
    return this.editWork(owner, sessionId, p!.revision, async (_s, r, c) => {
      if (r.token !== p!.token) error('stale', 'Context changed after preview.')
      await this.deps.store.applyHistoricalBindings(p!.bindings, p!.revision, c)
      c.assertCurrent()
    })
  }
  async previewForget(owner: string, sessionId: string): Promise<BriefForgetPreview> {
    const s = this.session(owner, sessionId)
    let preview: BriefForgetPreview | undefined
    await this.work(s, randomUUID(), async (c) => {
      const r = await this.resolve(s, c, false)
      c.assertCurrent()
      const current = await this.deps.store.previewForget(r.snapshot.accountId, c)
      c.assertCurrent()
      preview = current
      return structuredClone(s.view)
    })
    if (!preview) error('unavailable', 'Forget preview unavailable.')
    return preview!
  }
  async forget(
    owner: string,
    sessionId: string,
    previewId: string,
    revision: number
  ): Promise<BriefView> {
    const s = this.session(owner, sessionId)
    if (s.operation) await this.cancel(owner, sessionId, s.operation.id)
    return this.work(s, randomUUID(), async (c) => {
      const r = await this.resolve(s, c, false, revision)
      c.assertCurrent()
      await this.deps.store.forget(r.snapshot.accountId, revision, c, previewId)
      c.assertCurrent()
      this.cache.clear()
      this.cacheBytes = 0
      this.previews.clear()
      // Do not recapture the just-forgotten account as a side effect of Forget.
      return this.hide(
        s,
        'stale',
        'Saved calendar context was forgotten. Reopen the event to start again.'
      )
    })
  }
}
