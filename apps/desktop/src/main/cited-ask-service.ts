import type {
  AskProgress,
  CitedAskRequest,
  CitedAskResult,
  CitedAnswerSnapshot,
  SnapshotValidation,
  CitationView
} from '../shared/cited-ask-api'
export type { CitedAskRequest } from '../shared/cited-ask-api'

export interface AskControl {
  ownerId: string
  runId: string
  signal: AbortSignal
  assertCurrent(): void // caller's event/account/correction fence; throws when changed
  onProgress?(phase: AskProgress): void
}
export interface CitedAskService {
  run(request: CitedAskRequest, control: AskControl): Promise<CitedAskResult>
  validate(
    snapshot: CitedAnswerSnapshot,
    currentRequest: CitedAskRequest,
    control: AskControl
  ): Promise<SnapshotValidation>
  resolveCitation(
    snapshot: CitedAnswerSnapshot,
    evidenceId: string,
    currentRequest: CitedAskRequest,
    control: AskControl
  ): Promise<CitationView>
  cancel(ownerId: string, runId: string): Promise<void> // resolves after producer cleanup
}

import type {
  EvidenceBundle,
  EvidenceSelection,
  EvidenceManifest,
  CensusRequest,
  CensusResult
} from '@repo/meetings-store/evidence-contract'
import type { SourceAnchor, SourceResolution } from '@repo/meetings-store/source-contract'
import type { CitedPromptInput, CitedGenerationOutput } from '@repo/ai'
import { isRecord } from '@repo/meetings-store/evidence'
import { libraryActivity, type LibraryActivity } from './library-activity'
import {
  citedRequestDigest,
  normalizeCitedRequest,
  parseCitedClaims,
  validUtf16Range,
  validatePromptInclusion,
  validateSnapshotStructure
} from './cited-ask-validation'

export interface CitedAskDependencies {
  /** Main rollout gate; no source/model work or cache admission while disabled. */
  enabled?(): boolean
  sources: {
    retrieveEvidence(selection: EvidenceSelection, signal?: AbortSignal): Promise<EvidenceBundle>
    validateEvidence(
      manifest: EvidenceManifest,
      signal?: AbortSignal
    ): Promise<'valid' | 'stale' | 'unavailable'>
    resolveAcknowledged(anchor: SourceAnchor, signal?: AbortSignal): Promise<SourceResolution>
    census?(request: CensusRequest, signal?: AbortSignal): Promise<CensusResult>
  }
  generate(
    input: CitedPromptInput,
    signal: AbortSignal
  ): Promise<CitedGenerationOutput & { engineId: string; modelArtifactRevision: string }>
  validateModel(engineId: string, revision: string): Promise<boolean>
  activity?: LibraryActivity
  audio?(
    snapshot: CitedAnswerSnapshot,
    evidenceId: string
  ): Promise<Extract<CitationView, { status: 'resolved' }>['audio']>
}
const fail = (
  code: Extract<CitedAskResult, { status: 'error' }>['code'],
  message: string
): never => {
  throw Object.assign(new Error(message), { code })
}
/** One main-owned producer. Home and briefs own their independent persistence/admission. */
export class MainCitedAskService implements CitedAskService {
  private active?: { ownerId: string; runId: string; abort: AbortController; done: Promise<void> }
  private readonly activity: LibraryActivity
  constructor(private readonly deps: CitedAskDependencies) {
    this.activity = deps.activity ?? libraryActivity
  }
  async run(input: CitedAskRequest, control: AskControl): Promise<CitedAskResult> {
    if (this.active)
      return {
        status: 'error',
        code: 'busy',
        message: 'Another cited answer is running. Retry when it finishes.'
      }
    const abort = new AbortController()
    let finish!: () => void
    const active = {
      ownerId: control.ownerId,
      runId: control.runId,
      abort,
      done: new Promise<void>((resolve) => {
        finish = resolve
      })
    }
    this.active = active // before relocation/readiness; cancellation never waits for either
    const onAbort = (): void => abort.abort()
    control.signal.addEventListener('abort', onAbort, { once: true })
    if (control.signal.aborted) abort.abort()
    const check = (): void => {
      abort.signal.throwIfAborted()
      control.assertCurrent()
      if (this.active !== active) fail('stale', 'Request ownership changed.')
    }
    const phase = (p: AskProgress): void => {
      check()
      control.onProgress?.(p)
    }
    const shared = { ...control, signal: abort.signal, assertCurrent: check }
    try {
      if (this.deps.enabled?.() === false)
        fail('unavailable', 'Cited answers are not enabled in this build.')
      const request = normalizeCitedRequest(input)
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(control.runId) || !control.ownerId)
        fail('unauthorized', 'Invalid request ownership.')
      phase('queued')
      return await this.activity.run(async () => {
        phase('retrieving')
        const evidence = await this.deps.sources.retrieveEvidence(request.selection, abort.signal)
        check()
        if (!evidence.coverage.scanComplete)
          fail(
            'unavailable',
            'Sources unavailable. Retry or explicitly narrow history; no answer was generated.'
          )
        const current = await this.deps.sources.validateEvidence(evidence.manifest, abort.signal)
        check()
        if (current !== 'valid') fail(current, 'Sources changed or became unavailable. Retry.')
        let snapshot: CitedAnswerSnapshot = {
          version: 1,
          runId: control.runId,
          purpose: request.purpose,
          askedAt: new Date().toISOString(),
          status:
            request.selection.mode === 'linked-history' ? 'no-history' : 'insufficient-evidence',
          claims: [],
          evidence,
          prompt: null,
          engineId: null,
          modelArtifactRevision: null,
          promptVersion: 1,
          requestSha256: citedRequestDigest(request),
          ...(request.purpose === 'calendar-brief'
            ? { consumerRevision: request.consumerRevision }
            : {})
        }
        if (evidence.ranges.length) {
          const speakers = new Map<string, string>()
          // Resolve every selected original before inference; a retrieval hit alone is not permission.
          for (const range of evidence.ranges) {
            const resolved = await this.deps.sources.resolveAcknowledged(range.anchor, abort.signal)
            check()
            if (resolved.status !== 'resolved')
              return fail(
                resolved.status === 'missing' ? 'stale' : resolved.status,
                'An original is no longer available.'
              )
            if (
              !validUtf16Range(resolved.passage.text, range.startUtf16, range.endUtf16) ||
              resolved.passage.text.slice(range.startUtf16, range.endUtf16) !== range.quote
            )
              fail('stale', 'Original range changed.')
            if (resolved.passage.speaker !== undefined)
              speakers.set(range.id, resolved.passage.speaker)
          }
          const promptInput: CitedPromptInput = {
            purpose: request.purpose,
            question:
              request.purpose === 'library-ask'
                ? request.selection.question
                : 'Summarize the dated prior commitments, decisions, and conflicting evidence relevant to this event. Abstain where unsupported.',
            ...(request.purpose === 'calendar-brief' ? { context: request.context.eventText } : {}),
            terms: [...evidence.coverage.phrases, ...evidence.coverage.terms],
            coverage: JSON.stringify({
              scanComplete: evidence.coverage.scanComplete,
              selectionComplete: evidence.coverage.selectionComplete,
              eligibleMeetings: evidence.coverage.eligibleMeetingCount,
              selectedMeetings: evidence.coverage.selectedMeetingCount,
              omissions: evidence.coverage.omissions,
              semanticCoverage: 'not-exhaustive'
            }),
            ranges: evidence.ranges.map((r) => {
              const m = evidence.meetings.find((m) => m.meetingId === r.anchor.meetingId)!
              return { ...r, title: m.title, occurredAt: m.occurredAt, speaker: speakers.get(r.id) }
            })
          }
          phase('preparing')
          phase('generating')
          const generated = await this.deps.generate(promptInput, abort.signal)
          check()
          validatePromptInclusion(generated.inclusion, evidence)
          if (generated.rawJson !== null) {
            if (generated.rawJson.length > 65536)
              fail('invalid-answer', 'The model answer exceeded the structured output limit.')
            let parsed: unknown
            try {
              parsed = JSON.parse(generated.rawJson)
            } catch {
              fail('invalid-answer', 'The model returned malformed JSON. Retry.')
            }
            const answer = parseCitedClaims(parsed, generated.inclusion.ranges)
            snapshot = {
              ...snapshot,
              ...answer,
              prompt: generated.inclusion,
              engineId: generated.engineId,
              modelArtifactRevision: generated.modelArtifactRevision
            }
          } else snapshot.status = 'insufficient-evidence'
        }
        phase('validating')
        const validation = await this.validate(snapshot, request, shared)
        check()
        if (validation.status !== 'valid')
          fail(validation.status === 'missing' ? 'stale' : validation.status, validation.reason)
        return {
          status:
            snapshot.status === 'no-history'
              ? 'no-history'
              : snapshot.status === 'insufficient-evidence'
                ? 'insufficient-evidence'
                : 'complete',
          snapshot
        }
      }, abort.signal)
    } catch (error) {
      const allowed = [
        'cancelled',
        'busy',
        'refine-query',
        'invalid-subset',
        'narrow-history',
        'unavailable',
        'retrieval-timeout',
        'model-absent',
        'model-failed',
        'question-too-large',
        'unsupported-model-budget',
        'output-limit',
        'invalid-answer',
        'stale',
        'unauthorized'
      ] as const
      const code = abort.signal.aborted
        ? 'cancelled'
        : isRecord(error) && allowed.includes(error.code as (typeof allowed)[number])
          ? (error.code as (typeof allowed)[number])
          : 'model-failed'
      return {
        status: 'error',
        code,
        message: abort.signal.aborted
          ? 'Answer cancelled.'
          : error instanceof Error
            ? error.message
            : 'Cited Ask failed. Retry.'
      }
    } finally {
      control.signal.removeEventListener('abort', onAbort)
      if (this.active === active) this.active = undefined
      finish()
    }
  }
  async validate(
    snapshot: CitedAnswerSnapshot,
    currentRequest: CitedAskRequest,
    control: AskControl
  ): Promise<SnapshotValidation> {
    const check = (): void => {
      control.signal.throwIfAborted()
      control.assertCurrent()
    }
    try {
      check()
      if (this.deps.enabled?.() === false)
        return { status: 'unavailable', reason: 'Cited answers are not enabled in this build.' }
      const request = normalizeCitedRequest(currentRequest)
      validateSnapshotStructure(snapshot)
      if (
        snapshot.purpose !== request.purpose ||
        snapshot.requestSha256 !== citedRequestDigest(request) ||
        (request.purpose === 'calendar-brief' &&
          snapshot.consumerRevision !== request.consumerRevision)
      )
        return {
          status: 'stale',
          reason: 'The question, history selection or caller context changed.'
        }
      const current = await this.deps.sources.retrieveEvidence(request.selection, control.signal)
      check()
      if (!current.coverage.scanComplete)
        return {
          status: 'unavailable',
          reason: 'The complete requested source domain is unavailable.'
        }
      const stable = (e: EvidenceBundle): string =>
        JSON.stringify({ ...e, coverage: { ...e.coverage, observedAt: '' } })
      if (stable(current) !== stable(snapshot.evidence))
        return {
          status: 'stale',
          reason: 'Sources, eligibility or coverage changed. Generate again.'
        }
      if (snapshot.prompt) {
        const valid = await this.deps.validateModel(
          snapshot.engineId!,
          snapshot.modelArtifactRevision!
        )
        check()
        if (!valid) return { status: 'stale', reason: 'The local model or policy changed.' }
        for (const range of snapshot.prompt.ranges) {
          const resolved = await this.deps.sources.resolveAcknowledged(range.anchor, control.signal)
          check()
          if (resolved.status !== 'resolved')
            return { status: resolved.status, reason: 'The cited original is no longer available.' }
          if (
            !validUtf16Range(resolved.passage.text, range.startUtf16, range.endUtf16) ||
            resolved.passage.text.slice(range.startUtf16, range.endUtf16) !== range.quote
          )
            return { status: 'stale', reason: 'The exact original quote changed.' }
        }
      }
      // Earlier passages can change while a later original is being resolved.
      const finalSources = await this.deps.sources.validateEvidence(
        snapshot.evidence.manifest,
        control.signal
      )
      check()
      if (finalSources !== 'valid')
        return { status: finalSources, reason: 'Original sources changed during validation.' }
      return { status: 'valid', observedAt: new Date().toISOString() }
    } catch (error) {
      return {
        status: isRecord(error) && error.code === 'unauthorized' ? 'unauthorized' : 'unavailable',
        reason: error instanceof Error ? error.message : 'Source validation unavailable.'
      }
    }
  }
  async resolveCitation(
    snapshot: CitedAnswerSnapshot,
    evidenceId: string,
    currentRequest: CitedAskRequest,
    control: AskControl
  ): Promise<CitationView> {
    const validation = await this.validate(snapshot, currentRequest, control)
    control.signal.throwIfAborted()
    control.assertCurrent()
    if (validation.status !== 'valid') return validation
    const range = snapshot.prompt?.ranges.find((r) => r.id === evidenceId)
    if (!range)
      return { status: 'missing', reason: 'This range was not included in the model request.' }
    const resolved = await this.deps.sources.resolveAcknowledged(range.anchor, control.signal)
    control.signal.throwIfAborted()
    control.assertCurrent()
    if (resolved.status !== 'resolved')
      return { status: resolved.status, reason: 'Original unavailable.' }
    if (
      !validUtf16Range(resolved.passage.text, range.startUtf16, range.endUtf16) ||
      resolved.passage.text.slice(range.startUtf16, range.endUtf16) !== range.quote
    )
      return { status: 'stale', reason: 'Original range changed.' }
    const audio = (await this.deps.audio?.(snapshot, evidenceId)) ?? {
      status: 'unavailable' as const
    }
    control.signal.throwIfAborted()
    control.assertCurrent()
    // Audio mapping is asynchronous and must not reopen a stale original display.
    const finalValidation = await this.validate(snapshot, currentRequest, control)
    control.signal.throwIfAborted()
    control.assertCurrent()
    if (finalValidation.status !== 'valid') return finalValidation
    const meeting = snapshot.evidence.meetings.find((m) => m.meetingId === range.anchor.meetingId)
    return {
      status: 'resolved',
      passage: resolved.passage,
      range,
      audio,
      occurredAt: meeting?.occurredAt ?? null,
      dateBasis: meeting?.dateBasis ?? 'unknown'
    }
  }
  async cancel(ownerId: string, runId: string): Promise<void> {
    const active = this.active
    if (!active || active.ownerId !== ownerId || active.runId !== runId) return
    active.abort.abort()
    await active.done
  }
  async invalidate(): Promise<void> {
    const active = this.active
    if (active) {
      active.abort.abort()
      await active.done
    }
  }
}
