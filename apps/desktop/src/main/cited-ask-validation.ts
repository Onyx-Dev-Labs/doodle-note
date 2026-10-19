import { digest } from '@repo/meetings-store/sources'
import { CITED_ASK_PROMPT_VERSION } from '../shared/cited-ask-api'
import {
  evidenceRangeId,
  isRecord,
  normalizeEvidenceSelection
} from '@repo/meetings-store/evidence'
import type { EvidenceBundle, EvidenceRange } from '@repo/meetings-store/evidence-contract'
import type {
  CitedAskRequest,
  CitedClaim,
  CitedAnswerSnapshot,
  PromptInclusion
} from '../shared/cited-ask-api'

export const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((k) => keys.includes(k))
const ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
export function normalizeCitedRequest(input: unknown): CitedAskRequest {
  if (!isRecord(input)) throw new Error('Invalid request')
  const selection = normalizeEvidenceSelection(input.selection)
  if (
    input.purpose === 'library-ask' &&
    selection.mode === 'question' &&
    hasOnlyKeys(input, ['purpose', 'selection'])
  )
    return { purpose: 'library-ask', selection }
  if (
    input.purpose === 'calendar-brief' &&
    selection.mode === 'linked-history' &&
    hasOnlyKeys(input, ['purpose', 'selection', 'context', 'consumerRevision']) &&
    isRecord(input.context) &&
    hasOnlyKeys(input.context, ['templateVersion', 'eventText']) &&
    input.context.templateVersion === 1 &&
    typeof input.context.eventText === 'string' &&
    input.context.eventText.length <= 4096 &&
    typeof input.consumerRevision === 'string' &&
    input.consumerRevision.length > 0 &&
    input.consumerRevision.length <= 4096
  )
    return {
      purpose: 'calendar-brief',
      selection,
      context: { templateVersion: 1, eventText: input.context.eventText },
      consumerRevision: input.consumerRevision
    }
  throw new Error('Invalid request')
}
export const citedRequestDigest = (request: CitedAskRequest): string =>
  digest(JSON.stringify(normalizeCitedRequest(request)))
export function validUtf16Range(text: string, start: number, end: number): boolean {
  const boundary = (n: number): boolean =>
    n === 0 ||
    n === text.length ||
    !(/[\uD800-\uDBFF]/.test(text[n - 1]!) && /[\uDC00-\uDFFF]/.test(text[n]!))
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= text.length &&
    boundary(start) &&
    boundary(end)
  )
}
export function validatePromptInclusion(prompt: PromptInclusion, evidence: EvidenceBundle): void {
  if (
    !isRecord(prompt) ||
    !hasOnlyKeys(prompt, [
      'ranges',
      'omittedRangeIds',
      'budgetComplete',
      'inputTokens',
      'contextWindowTokens',
      'outputReserveTokens',
      'safetyMarginTokens',
      'accounting',
      'wireSha256'
    ]) ||
    !Array.isArray(prompt.ranges) ||
    prompt.ranges.length > 24 ||
    !Array.isArray(prompt.omittedRangeIds) ||
    prompt.accounting !== 'tokenizer' ||
    typeof prompt.wireSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(prompt.wireSha256)
  )
    throw new Error('Invalid prompt inclusion')
  const counts = [
    prompt.inputTokens,
    prompt.contextWindowTokens,
    prompt.outputReserveTokens,
    prompt.safetyMarginTokens
  ]
  if (
    !counts.every((n) => Number.isSafeInteger(n) && n >= 0) ||
    prompt.outputReserveTokens < 4096 ||
    prompt.safetyMarginTokens < 256 ||
    prompt.inputTokens + prompt.outputReserveTokens + prompt.safetyMarginTokens >
      prompt.contextWindowTokens
  )
    throw new Error('Invalid prompt budget')
  const parents = new Set<string>(),
    ids = new Set<string>()
  for (const range of prompt.ranges) {
    if (
      !isRecord(range) ||
      !hasOnlyKeys(range, ['id', 'anchor', 'quote', 'startUtf16', 'endUtf16', 'parentRangeId']) ||
      typeof range.quote !== 'string'
    )
      throw new Error('Invalid prompt range')
    const parent = evidence.ranges.find((p) => p.id === range.parentRangeId)
    if (
      !parent ||
      parents.has(parent.id) ||
      ids.has(range.id) ||
      JSON.stringify(parent.anchor) !== JSON.stringify(range.anchor)
    )
      throw new Error('Invalid prompt parent')
    const start = range.startUtf16 - parent.startUtf16,
      end = range.endUtf16 - parent.startUtf16
    if (
      !validUtf16Range(parent.quote, start, end) ||
      parent.quote.slice(start, end) !== range.quote ||
      evidenceRangeId(range.anchor, range.startUtf16, range.endUtf16, range.quote) !== range.id
    )
      throw new Error('Invalid prompt range membership')
    parents.add(parent.id)
    ids.add(range.id)
  }
  const omitted = evidence.ranges.filter((r) => !parents.has(r.id)).map((r) => r.id)
  const complete = omitted.length === 0 && prompt.ranges.every((r) => r.id === r.parentRangeId)
  if (
    JSON.stringify(omitted) !== JSON.stringify(prompt.omittedRangeIds) ||
    complete !== prompt.budgetComplete
  )
    throw new Error('Invalid prompt coverage')
}
export function parseCitedClaims(
  raw: unknown,
  ranges: EvidenceRange[]
): { status: 'answered' | 'conflicting-evidence' | 'insufficient-evidence'; claims: CitedClaim[] } {
  const invalid = (): never => {
    throw Object.assign(new Error('The model returned an invalid cited answer. Retry.'), {
      code: 'invalid-answer'
    })
  }
  if (
    !isRecord(raw) ||
    !hasOnlyKeys(raw, ['status', 'claims']) ||
    !['answered', 'conflicting-evidence', 'insufficient-evidence'].includes(String(raw.status)) ||
    !Array.isArray(raw.claims) ||
    raw.claims.length > 12
  )
    return invalid()
  if ((raw.status === 'insufficient-evidence') !== (raw.claims.length === 0)) return invalid()
  const seen = new Set<string>()
  const claims = raw.claims.map((c: unknown): CitedClaim => {
    if (
      !isRecord(c) ||
      !hasOnlyKeys(c, ['id', 'text', 'kind', 'evidenceIds']) ||
      typeof c.id !== 'string' ||
      !ID.test(c.id) ||
      seen.has(c.id) ||
      typeof c.text !== 'string' ||
      !c.text.trim() ||
      c.text.length > 4096 ||
      !['quotation', 'paraphrase', 'conflict'].includes(String(c.kind)) ||
      !Array.isArray(c.evidenceIds) ||
      c.evidenceIds.length < 1 ||
      c.evidenceIds.length > 4 ||
      new Set(c.evidenceIds).size !== c.evidenceIds.length
    )
      return invalid()
    if (c.evidenceIds.some((id) => typeof id !== 'string' || !ranges.some((r) => r.id === id)))
      return invalid()
    if (c.kind === 'conflict' && c.evidenceIds.length < 2) return invalid()
    seen.add(c.id)
    return {
      id: c.id,
      text:
        c.kind === 'quotation'
          ? c.evidenceIds.map((id) => ranges.find((r) => r.id === id)!.quote).join('\n')
          : c.text,
      kind: c.kind as CitedClaim['kind'],
      evidenceIds: c.evidenceIds as string[]
    }
  })
  if (raw.status === 'conflicting-evidence' && !claims.some((c) => c.kind === 'conflict'))
    return invalid()
  return {
    status: raw.status as 'answered' | 'conflicting-evidence' | 'insufficient-evidence',
    claims
  }
}
export function validateSnapshotStructure(snapshot: CitedAnswerSnapshot): void {
  if (
    !isRecord(snapshot) ||
    snapshot.version !== 1 ||
    ![1, 2, CITED_ASK_PROMPT_VERSION].includes(snapshot.promptVersion) ||
    typeof snapshot.runId !== 'string' ||
    !ID.test(snapshot.runId) ||
    typeof snapshot.askedAt !== 'string' ||
    !Number.isFinite(Date.parse(snapshot.askedAt)) ||
    !isRecord(snapshot.evidence) ||
    snapshot.evidence.version !== 1 ||
    !Array.isArray(snapshot.evidence.ranges) ||
    snapshot.evidence.ranges.length > 24 ||
    !isRecord(snapshot.evidence.manifest) ||
    !isRecord(snapshot.evidence.coverage) ||
    snapshot.evidence.coverage.scanComplete !== true ||
    !Array.isArray(snapshot.claims)
  )
    throw new Error('Invalid snapshot')
  if (snapshot.prompt !== null) {
    validatePromptInclusion(snapshot.prompt, snapshot.evidence)
    if (
      typeof snapshot.engineId !== 'string' ||
      !snapshot.engineId.startsWith('local:') ||
      typeof snapshot.modelArtifactRevision !== 'string' ||
      !snapshot.modelArtifactRevision
    )
      throw new Error('Invalid model identity')
  } else if (
    snapshot.engineId !== null ||
    snapshot.modelArtifactRevision !== null ||
    snapshot.claims.length ||
    !['no-history', 'insufficient-evidence'].includes(snapshot.status)
  )
    throw new Error('Invalid empty snapshot')
  if (snapshot.status === 'no-history') {
    if (snapshot.claims.length || snapshot.prompt !== null || snapshot.evidence.ranges.length)
      throw new Error('Invalid no-history snapshot')
  } else {
    const parsed = parseCitedClaims(
      { status: snapshot.status, claims: snapshot.claims },
      snapshot.prompt?.ranges ?? []
    )
    if (JSON.stringify(parsed.claims) !== JSON.stringify(snapshot.claims))
      throw new Error('Invalid stored quotations')
  }
}
