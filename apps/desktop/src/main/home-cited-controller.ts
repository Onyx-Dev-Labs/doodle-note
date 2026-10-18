import type { CitedSourceAudio } from './cited-source-audio'
import type {
  EvidenceFilters,
  CensusRequest,
  CensusResult
} from '@repo/meetings-store/evidence-contract'
import { isRecord, normalizeEvidenceFilters } from '@repo/meetings-store/evidence'
import type {
  AskProgress,
  CitedAskRequest,
  CitationView,
  CitedAudioPlayback
} from '../shared/cited-ask-api'
import type { HomeCitedResult, HomeCitedEntry } from '../shared/home-cited-api'
import type { GlobalChatEntry } from '../shared/notes-api'
import type { CitedAskService, AskControl } from './cited-ask-service'
import type { CitedOwnerLease } from './cited-ask-host'
import { GlobalChatStore, CITED_CHAT_FALLBACK } from './global-chat-store'
import { libraryActivity, type LibraryActivity } from './library-activity'
import { citedRequestDigest } from './cited-ask-validation'
const ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
interface Dependencies {
  store: GlobalChatStore
  cited: CitedAskService
  enabled(): boolean
  audio?: Pick<CitedSourceAudio, 'play'>
  activity?: LibraryActivity
  census?(request: CensusRequest, signal: AbortSignal): Promise<CensusResult>
}
/** Home owns persistence/admission only. Calendar uses the same cited service independently. */
export class HomeCitedController {
  private revision = 0
  private clearing = false
  private active?: { ownerId: string; runId: string; abort: AbortController; done: Promise<void> }
  private readonly activity: LibraryActivity
  constructor(private readonly deps: Dependencies) {
    this.activity = deps.activity ?? libraryActivity
  }
  private checkOwner(owner: CitedOwnerLease): void {
    owner.signal.throwIfAborted()
    owner.assertCurrent()
    if (!this.deps.enabled()) throw new Error('Cited answers are unavailable in this build.')
  }
  private fromEntry(entry: GlobalChatEntry): CitedAskRequest {
    const snapshot = entry.citedAnswer
    const selection = snapshot?.evidence.manifest.selection
    if (
      !snapshot ||
      snapshot.purpose !== 'library-ask' ||
      selection?.mode !== 'question' ||
      selection.question !== entry.question ||
      entry.id !== snapshot.runId
    )
      throw new Error('Saved request is invalid.')
    return { purpose: 'library-ask', selection }
  }
  async ask(
    input: unknown,
    owner: CitedOwnerLease,
    onProgress?: (phase: AskProgress) => void
  ): Promise<HomeCitedResult> {
    if (this.active || this.clearing)
      return {
        status: 'error',
        code: 'busy',
        message: 'A Home answer is still finishing. Retry after it stops.'
      }
    const abort = new AbortController()
    const onAbort = (): void => abort.abort()
    owner.signal.addEventListener('abort', onAbort, { once: true })
    if (owner.signal.aborted) abort.abort()
    let finish!: () => void
    const active = {
      ownerId: owner.ownerId,
      runId: '',
      abort,
      done: new Promise<void>((r) => {
        finish = r
      })
    }
    this.active = active
    try {
      this.checkOwner(owner)
      if (
        !isRecord(input) ||
        Object.keys(input).some((k) => !['runId', 'question', 'filters'].includes(k)) ||
        typeof input.runId !== 'string' ||
        !ID.test(input.runId) ||
        typeof input.question !== 'string' ||
        input.question.length > 4096
      )
        return {
          status: 'error',
          code: 'refine-query',
          message: 'Use a question of at most 4,096 characters and a new run ID.'
        }
      active.runId = input.runId
      const filters: EvidenceFilters = normalizeEvidenceFilters(input.filters)
      const request: CitedAskRequest = {
        purpose: 'library-ask',
        selection: { mode: 'question', question: input.question, filters }
      }
      const revision = this.revision
      return await this.activity.run(async () => {
        const epoch = this.deps.store.epoch()
        const check = (): void => {
          abort.signal.throwIfAborted()
          this.checkOwner(owner)
          if (
            this.active !== active ||
            this.revision !== revision ||
            this.deps.store.epoch() !== epoch
          )
            throw new Error('Request or history changed.')
        }
        const control: AskControl = {
          ownerId: owner.ownerId,
          runId: active.runId,
          signal: abort.signal,
          assertCurrent: check,
          onProgress
        }
        check()
        const existing = this.deps.store.read().find((e) => e.id === active.runId)
        if (existing) {
          if (citedRequestDigest(this.fromEntry(existing)) !== citedRequestDigest(request))
            return {
              status: 'error',
              code: 'stale',
              message: 'This run ID belongs to another question.'
            }
          const admission = await this.deps.cited.validate(existing.citedAnswer!, request, control)
          check()
          if (admission.status !== 'valid')
            return { status: 'error', code: 'stale', message: admission.reason }
          const snapshot = existing.citedAnswer!
          return {
            status:
              snapshot.status === 'no-history'
                ? 'no-history'
                : snapshot.status === 'insufficient-evidence'
                  ? 'insufficient-evidence'
                  : 'complete',
            snapshot,
            saved: true
          }
        }
        const result = await this.deps.cited.run(request, control)
        check()
        if (result.status === 'error') return result
        const admission = await this.deps.cited.validate(result.snapshot, request, control)
        check()
        if (admission.status !== 'valid')
          return {
            status: 'error',
            code: admission.status === 'missing' ? 'stale' : admission.status,
            message: admission.reason
          }
        const entry: GlobalChatEntry = {
          id: active.runId,
          question: request.selection.question,
          answer: CITED_CHAT_FALLBACK,
          askedAt: result.snapshot.askedAt,
          citedAnswer: result.snapshot
        }
        try {
          this.deps.store.append(entry, epoch)
        } catch {
          check()
          return {
            ...result,
            saved: false,
            saveError: 'The answer could not be saved. Existing history is unchanged.'
          }
        }
        return { ...result, saved: true }
      }, abort.signal)
    } catch {
      return {
        status: 'error',
        code: abort.signal.aborted ? 'cancelled' : 'unavailable',
        message: abort.signal.aborted
          ? 'Answer cancelled.'
          : 'Sources or history changed or are unavailable. Nothing was saved. Retry.'
      }
    } finally {
      owner.signal.removeEventListener('abort', onAbort)
      if (this.active === active) this.active = undefined
      finish()
    }
  }
  async cancel(runId: unknown, owner: CitedOwnerLease): Promise<void> {
    owner.assertCurrent()
    if (typeof runId !== 'string' || !ID.test(runId)) throw new Error('Invalid run ID.')
    const active = this.active
    if (!active || active.ownerId !== owner.ownerId || active.runId !== runId) return
    active.abort.abort()
    await this.deps.cited.cancel(active.ownerId, active.runId)
    await active.done
  }
  async invalidate(): Promise<void> {
    this.revision++
    const active = this.active
    if (active) {
      active.abort.abort()
      await this.deps.cited.cancel(active.ownerId, active.runId)
      await active.done
    }
  }
  async clear(owner: CitedOwnerLease): Promise<void> {
    this.checkOwner(owner)
    if (this.clearing) throw new Error('History is already being cleared.')
    this.clearing = true
    try {
      await this.invalidate()
      await this.activity.run(() => {
        this.checkOwner(owner)
        this.deps.store.clear()
      }, owner.signal)
    } finally {
      this.clearing = false
    }
  }
  async history(owner: CitedOwnerLease): Promise<{ entries: HomeCitedEntry[]; error?: string }> {
    try {
      this.checkOwner(owner)
      const revision = this.revision
      return await this.activity.run(async () => {
        const epoch = this.deps.store.epoch()
        const check = (): void => {
          this.checkOwner(owner)
          if (this.revision !== revision || this.deps.store.epoch() !== epoch)
            throw new Error('History changed.')
        }
        const entries: HomeCitedEntry[] = []
        for (const [i, entry] of this.deps.store.read().entries()) {
          check()
          const base = {
            id: entry.id ?? `legacy-${i}`,
            question: entry.question,
            askedAt: entry.askedAt
          }
          if (!entry.citedAnswer) {
            entries.push({ ...base, status: 'legacy', answer: entry.answer })
            continue
          }
          const admission = await this.deps.cited.validate(
            entry.citedAnswer,
            this.fromEntry(entry),
            { ...owner, runId: entry.id!, assertCurrent: check }
          )
          check()
          entries.push(
            admission.status === 'valid'
              ? { ...base, status: 'valid', snapshot: entry.citedAnswer }
              : { ...base, ...admission }
          )
        }
        check()
        return { entries }
      }, owner.signal)
    } catch {
      return {
        entries: [],
        error: 'History could not be safely loaded. Existing history is preserved.'
      }
    }
  }
  async resolve(
    entryId: unknown,
    evidenceId: unknown,
    owner: CitedOwnerLease
  ): Promise<CitationView> {
    try {
      this.checkOwner(owner)
      if (
        typeof entryId !== 'string' ||
        !ID.test(entryId) ||
        typeof evidenceId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(evidenceId)
      )
        throw new Error('Invalid citation')
      const revision = this.revision
      return await this.activity.run(async () => {
        const epoch = this.deps.store.epoch()
        const entry = this.deps.store.read().find((e) => e.id === entryId)
        if (!entry?.citedAnswer)
          return { status: 'missing', reason: 'This saved answer is unavailable.' }
        const check = (): void => {
          this.checkOwner(owner)
          if (this.revision !== revision || this.deps.store.epoch() !== epoch)
            throw new Error('History changed.')
        }
        const view = await this.deps.cited.resolveCitation(
          entry.citedAnswer,
          evidenceId,
          this.fromEntry(entry),
          { ...owner, runId: entryId, assertCurrent: check }
        )
        check()
        return view
      }, owner.signal)
    } catch {
      return {
        status: 'unavailable',
        reason: 'This original could not be validated. Retry or generate a new answer.'
      }
    }
  }
  async play(
    entryId: unknown,
    evidenceId: unknown,
    token: unknown,
    owner: CitedOwnerLease
  ): Promise<CitedAudioPlayback> {
    try {
      this.checkOwner(owner)
      if (
        !this.deps.audio ||
        typeof entryId !== 'string' ||
        !ID.test(entryId) ||
        typeof evidenceId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(evidenceId)
      )
        throw new Error('Invalid citation')
      const revision = this.revision
      return await this.activity.run(async () => {
        const epoch = this.deps.store.epoch()
        const check = (): void => {
          this.checkOwner(owner)
          // Retire playback before a transfer instead of starting more nested reads behind it.
          if (
            this.activity.moving ||
            this.revision !== revision ||
            this.deps.store.epoch() !== epoch
          )
            throw new Error('Playback ownership changed.')
        }
        check()
        const entry = this.deps.store.read().find((e) => e.id === entryId)
        if (!entry?.citedAnswer) throw new Error('Saved answer unavailable')
        const request = this.fromEntry(entry)
        const control = { ...owner, runId: entryId, assertCurrent: check }
        const before = await this.deps.cited.validate(entry.citedAnswer, request, control)
        check()
        if (before.status !== 'valid') throw new Error('Source changed')
        const playback = await this.deps.audio!.play(token, entry.citedAnswer, evidenceId)
        check()
        const after = await this.deps.cited.validate(entry.citedAnswer, request, control)
        check()
        if (after.status !== 'valid') throw new Error('Source changed')
        return playback
      }, owner.signal)
    } catch {
      throw new Error('Recording playback is unavailable. Reopen the original and retry.')
    }
  }
  async census(request: CensusRequest, owner: CitedOwnerLease): Promise<CensusResult> {
    this.checkOwner(owner)
    return this.activity.run(async () => {
      const result = await this.deps.census!(request, owner.signal)
      this.checkOwner(owner)
      return result
    }, owner.signal)
  }
}
