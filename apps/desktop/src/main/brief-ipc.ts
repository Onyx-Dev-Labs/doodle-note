import { BRIEFS_INVOKE } from '../shared/briefs-api'
import type { BriefApi, BriefEdit, BriefLinkTarget, BriefSelection } from '../shared/briefs-api'
import type { BriefService } from './brief-service'
import type { CitedRendererOwners } from './cited-ask-host'
import { contextObject, contextText, contextUuid } from './calendar-context-validation'

export type BriefCommands = Pick<
  BriefService,
  Exclude<keyof BriefApi, 'onState' | 'onWarning' | 'available'> | 'closeOwner'
>
export type BriefIpcEvent = Parameters<CitedRendererOwners['capture']>[0]
interface Dependencies {
  ipc: {
    handle(
      channel: string,
      callback: (event: BriefIpcEvent, request: unknown) => Promise<unknown>
    ): void
    removeHandler(channel: string): void
  }
  owners: CitedRendererOwners
  service: BriefCommands
  enabled(): boolean
}
const invalid = (): never => {
  throw new Error('Invalid brief request.')
}
const keys = (v: unknown, allowed: string[]): Record<string, unknown> => {
  if (!contextObject(v) || Object.keys(v).some((k) => !allowed.includes(k))) return invalid()
  return v
}
const text = (v: unknown, max: number): string => (contextText(v, max) ? v : invalid())
const uuid = (v: unknown): string => (contextUuid(v) ? v : invalid())
const revision = (v: unknown): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid()
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : invalid())
const optionalUuid = (v: unknown): string | null => (v === null ? null : uuid(v))
const meetingId = (v: unknown): string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(v) ? v : invalid()
function selection(value: unknown): BriefSelection {
  const v = keys(value, ['meetingIds', 'includeCompany', 'topic'])
  if (v.meetingIds !== undefined && (!Array.isArray(v.meetingIds) || v.meetingIds.length > 4096))
    invalid()
  return {
    ...(v.meetingIds === undefined
      ? {}
      : { meetingIds: (v.meetingIds as unknown[]).map(meetingId) }),
    ...(v.includeCompany === undefined ? {} : { includeCompany: bool(v.includeCompany) }),
    ...(v.topic === undefined ? {} : { topic: text(v.topic, 1024) })
  }
}
function edit(value: unknown): BriefEdit {
  const v = keys(value, [
    'op',
    'name',
    'inviteeId',
    'personId',
    'future',
    'isSelf',
    'companyId',
    'entity',
    'id',
    'linkId'
  ])
  switch (v.op) {
    case 'create-person':
    case 'create-company':
      keys(v, ['op', 'name'])
      return { op: v.op, name: text(v.name, 256) }
    case 'bind':
      keys(v, ['op', 'inviteeId', 'personId', 'future'])
      return {
        op: v.op,
        inviteeId: text(v.inviteeId, 200),
        personId: optionalUuid(v.personId),
        future: bool(v.future)
      }
    case 'exclude':
      keys(v, ['op', 'inviteeId', 'personId'])
      return { op: v.op, inviteeId: text(v.inviteeId, 200), personId: uuid(v.personId) }
    case 'self':
      keys(v, ['op', 'inviteeId', 'isSelf'])
      return { op: v.op, inviteeId: text(v.inviteeId, 200), isSelf: bool(v.isSelf) }
    case 'company':
      keys(v, ['op', 'personId', 'companyId'])
      return { op: v.op, personId: uuid(v.personId), companyId: optionalUuid(v.companyId) }
    case 'rename':
      keys(v, ['op', 'entity', 'id', 'name'])
      if (v.entity !== 'person' && v.entity !== 'company') return invalid()
      return { op: v.op, entity: v.entity, id: uuid(v.id), name: text(v.name, 256) }
    case 'unlink':
      keys(v, ['op', 'linkId'])
      return { op: v.op, linkId: uuid(v.linkId) }
    default:
      return invalid()
  }
}
function target(value: unknown): BriefLinkTarget {
  const v = keys(value, ['kind', 'personId', 'companyId'])
  if (v.kind === 'event') {
    keys(v, ['kind'])
    return { kind: 'event' }
  }
  if (v.kind === 'person') {
    keys(v, ['kind', 'personId'])
    return { kind: 'person', personId: uuid(v.personId) }
  }
  if (v.kind === 'company') {
    keys(v, ['kind', 'companyId'])
    return { kind: 'company', companyId: uuid(v.companyId) }
  }
  return invalid()
}

/** Cancellation deliberately has no library barrier; each service operation owns its own lease. */
export function installBriefIpc({
  ipc,
  owners,
  service,
  enabled
}: Dependencies): () => Promise<void> {
  const leases = new Map<string, () => void>()
  const cleanup = new Set<Promise<void>>()
  const requests = new Set<Promise<unknown>>()
  let disposed = false
  let disposal: Promise<void> | undefined
  const closeOwner = (owner: string): Promise<void> => {
    const pending = service.closeOwner(owner)
    cleanup.add(pending)
    void pending.catch(() => {}).finally(() => cleanup.delete(pending))
    return pending
  }
  const invoke = async (event: BriefIpcEvent, request: unknown): Promise<unknown> => {
    if (disposed) throw new Error('Brief IPC is disposed.')
    const lease = owners.capture(event)
    lease.assertCurrent()
    if (!leases.has(lease.ownerId)) {
      const abort = (): void => {
        leases.delete(lease.ownerId)
        void closeOwner(lease.ownerId).catch(() => {})
      }
      lease.signal.addEventListener('abort', abort, { once: true })
      leases.set(lease.ownerId, () => lease.signal.removeEventListener('abort', abort))
    }
    const r = keys(request, ['method', 'args'])
    if (typeof r.method !== 'string' || !Array.isArray(r.args)) return invalid()
    const a = r.args
    const count = (expected: number): void => {
      if (a.length !== expected) invalid()
    }
    if (r.method === 'available') {
      count(0)
      return enabled()
    }
    if (!enabled()) throw new Error('Local briefs are disabled.')
    const owner = lease.ownerId
    let result: unknown
    switch (r.method) {
      case 'open':
        count(1)
        if (typeof a[0] !== 'string' || !/^cal2:event:[a-f0-9]{64}$/.test(a[0])) return invalid()
        result = await service.open(owner, a[0])
        break
      case 'select':
        count(2)
        result = await service.select(owner, uuid(a[0]), selection(a[1]))
        break
      case 'refresh':
        count(1)
        result = await service.refresh(owner, uuid(a[0]))
        break
      case 'generate':
        count(3)
        result = await service.generate(owner, uuid(a[0]), meetingId(a[1]), selection(a[2]))
        break
      case 'edit':
        count(3)
        result = await service.edit(owner, uuid(a[0]), revision(a[1]), edit(a[2]))
        break
      case 'candidates':
        count(2)
        result = await service.candidates(owner, uuid(a[0]), text(a[1], 256))
        break
      case 'link':
        count(4)
        result = await service.link(
          owner,
          uuid(a[0]),
          revision(a[1]),
          meetingId(a[2]),
          target(a[3])
        )
        break
      case 'previewHistory':
        count(4)
        result = await service.previewHistory(
          owner,
          uuid(a[0]),
          revision(a[1]),
          text(a[2], 200),
          optionalUuid(a[3])
        )
        break
      case 'applyHistory':
        count(2)
        result = await service.applyHistory(owner, uuid(a[0]), uuid(a[1]))
        break
      case 'previewForget':
        count(1)
        result = await service.previewForget(owner, uuid(a[0]))
        break
      case 'forget':
        count(3)
        result = await service.forget(owner, uuid(a[0]), uuid(a[1]), revision(a[2]))
        break
      case 'citation':
        count(2)
        result = await service.citation(owner, uuid(a[0]), text(a[1], 200))
        break
      case 'play':
        count(3)
        result = await service.play(owner, uuid(a[0]), text(a[1], 200), text(a[2], 200))
        break
      case 'cancel':
        count(2)
        result = await service.cancel(owner, uuid(a[0]), meetingId(a[1]))
        break
      case 'close':
        count(1)
        result = await service.close(owner, uuid(a[0]))
        break
      default:
        return invalid()
    }
    lease.assertCurrent()
    if (disposed || !enabled()) throw new Error('Brief IPC became unavailable.')
    return result
  }
  ipc.handle(BRIEFS_INVOKE, (event, request) => {
    const pending = invoke(event, request)
    requests.add(pending)
    void pending.catch(() => {}).finally(() => requests.delete(pending))
    return pending
  })
  return () => {
    if (disposal) return disposal
    disposed = true
    ipc.removeHandler(BRIEFS_INVOKE)
    for (const [owner, unsubscribe] of leases) {
      unsubscribe()
      void closeOwner(owner).catch(() => {})
    }
    leases.clear()
    disposal = Promise.allSettled([...cleanup, ...requests]).then(() => {})
    return disposal
  }
}
