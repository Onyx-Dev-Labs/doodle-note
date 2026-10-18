import { constants, lstatSync, type BigIntStats } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { sameScope } from '@repo/meetings-store/sources'
import type { EvidenceBundle, EvidenceMeetingMeta } from '@repo/meetings-store/evidence-contract'
import type { SourceIndexService } from './source-index-service'
import type { CalendarLinkedOriginal } from './calendar-start-context'
import { CalendarContextStore, type ContextControl } from './calendar-context-store'
import { CalendarContextCodec } from './calendar-context-codec'
import { libraryActivity, type LibraryActivity } from './library-activity'

type Original = CalendarLinkedOriginal & EvidenceMeetingMeta
type Binding = ReturnType<CalendarContextStore['fence']>
// Admission bound for this optional association reader, not an original format limit.
// Larger originals remain untouched and report unavailable for linking/briefs.
const MAX_NOMINATION_BYTES = 16 * 1024 * 1024
const validId = (id: string): void => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(id))
    throw new Error('Invalid original identity.')
}
const fingerprint = (stat: BigIntStats): string => {
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Original is unavailable.')
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}

/** Metadata nominations only. Shared evidence owns eligibility, source dates, retrieval and citations. */
export class BriefOriginals {
  private codec = new CalendarContextCodec()
  private closed = false
  private pending = new Set<Promise<unknown>>()
  private current = new WeakMap<Original, () => void>()
  constructor(
    private store: CalendarContextStore,
    private sources: Pick<SourceIndexService, 'retrieveEvidence' | 'census'>,
    private activity: LibraryActivity = libraryActivity
  ) {}
  private check(binding: Binding, control: ContextControl): void {
    control.signal?.throwIfAborted()
    control.assertCurrent()
    if (this.closed) throw new Error('Original nominations are disposed.')
    binding.assertCurrent()
  }
  private work<T>(control: ContextControl, action: (binding: Binding) => Promise<T>): Promise<T> {
    const pending = this.activity.run(async () => {
      const binding = this.store.fence()
      this.check(binding, control)
      return action(binding)
    }, control.signal)
    this.pending.add(pending)
    void pending.catch(() => {}).finally(() => this.pending.delete(pending))
    return pending
  }
  /** Conservative before-upsert existence: uncertain paths must never create automatic history. */
  exists(id: string): boolean {
    validId(id)
    const binding = this.store.fence()
    try {
      lstatSync(join(binding.root, 'meetings', id + '.json'))
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
      return true
    }
  }
  private async nominate(
    id: string,
    bundle: EvidenceBundle,
    binding: Binding,
    control: ContextControl
  ): Promise<Original | null> {
    validId(id)
    this.check(binding, control)
    if (
      !bundle.coverage.scanComplete ||
      !sameScope(bundle.manifest.scope, binding.scope) ||
      !sameScope(bundle.coverage.scope, binding.scope)
    )
      throw new Error('Original history is unavailable.')
    const meta = bundle.meetings.find((m) => m.meetingId === id)
    const dependency = bundle.manifest.dependencies.find((d) => d.meetingId === id)
    if (!meta || !dependency) return null
    const path = join(binding.root, 'meetings', id + '.json')
    const before = lstatSync(path, { bigint: true })
    const token = fingerprint(before)
    if (before.size > BigInt(MAX_NOMINATION_BYTES))
      throw new Error('Original association exceeds capacity.')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    let bytes: Buffer
    try {
      this.check(binding, control)
      if (fingerprint(await file.stat({ bigint: true })) !== token)
        throw new Error('Original changed.')
      this.check(binding, control)
      const buffer = Buffer.alloc(Number(before.size) + 1)
      let count = 0
      while (count < buffer.length) {
        const read = await file.read(buffer, count, buffer.length - count, count)
        this.check(binding, control)
        if (!read.bytesRead) break
        count += read.bytesRead
      }
      if (count !== Number(before.size)) throw new Error('Original changed.')
      bytes = buffer.subarray(0, count)
    } finally {
      await file.close()
    }
    this.check(binding, control)
    // Parse/hash off main; only id/eventId/digest cross back, never full original text.
    const raw = await this.codec.originalMetadata(bytes)
    this.check(binding, control)
    if (
      raw.id !== id ||
      raw.digest !== dependency.rawSha256 ||
      fingerprint(lstatSync(path, { bigint: true })) !== token
    )
      throw new Error('Original changed.')
    const result: Original = {
      ...meta,
      calendarEventId: raw.calendarEventId,
      scope: binding.scope,
      rawSha256: dependency.rawSha256,
      projectedRevisionId: dependency.projectedRevisionId,
      trashed: false
    }
    this.current.set(result, () => {
      if (this.closed) throw new Error('Original nominations are disposed.')
      binding.assertCurrent()
      if (fingerprint(lstatSync(path, { bigint: true })) !== token)
        throw new Error('Original changed.')
    })
    return result
  }
  get(id: string, control: ContextControl): Promise<Original | null> {
    validId(id)
    return this.work(control, async (binding) => {
      try {
        const bundle = await this.sources.retrieveEvidence(
          { mode: 'linked-history', meetingIds: [id] },
          control.signal
        )
        this.check(binding, control)
        const original = await this.nominate(id, bundle, binding, control)
        this.check(binding, control)
        return original
      } catch {
        this.check(binding, control)
        return null
      }
    })
  }
  list(query: string, control: ContextControl): Promise<EvidenceMeetingMeta[]> {
    if (typeof query !== 'string' || query.length > 256) throw new Error('Narrow original search.')
    return this.work(control, async (binding) => {
      const census = await this.sources.census(
        {
          filters: {},
          predicate: query.trim() ? { kind: 'literal', text: query } : { kind: 'eligible' }
        },
        control.signal
      )
      this.check(binding, control)
      if (!census.exact || !sameScope(census.scope, binding.scope))
        throw new Error('Original history is unavailable.')
      const ids = census.meetings.slice(0, 50).map((m) => m.meetingId)
      if (!ids.length) return []
      const bundle = await this.sources.retrieveEvidence(
        { mode: 'linked-history', meetingIds: ids },
        control.signal
      )
      this.check(binding, control)
      const result: EvidenceMeetingMeta[] = []
      for (const id of ids) {
        const original = await this.nominate(id, bundle, binding, control)
        this.check(binding, control)
        if (!original) throw new Error('Original history is unavailable.')
        result.push({
          meetingId: id,
          title: original.title,
          occurredAt: original.occurredAt,
          dateBasis: original.dateBasis
        })
      }
      return result
    })
  }
  assertCurrent(original: Original): void {
    const assertCurrent = this.current.get(original)
    if (!assertCurrent) throw new Error('Original nomination is unavailable.')
    assertCurrent()
  }
  async dispose(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.pending])
    await this.codec.close()
  }
}
