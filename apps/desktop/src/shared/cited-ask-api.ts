import type {
  EvidenceSelection,
  EvidenceRange,
  EvidenceBundle
} from '@repo/meetings-store/evidence-contract'
import type { SourcePassage } from '@repo/meetings-store/source-contract'

/** Current generation policy; historical v1 remains decodable but cannot be admitted. */
export const CITED_ASK_PROMPT_VERSION = 2 as const

export type CitedAskRequest =
  | { purpose: 'library-ask'; selection: Extract<EvidenceSelection, { mode: 'question' }> }
  | {
      purpose: 'calendar-brief'
      selection: Extract<EvidenceSelection, { mode: 'linked-history' }>
      context: { templateVersion: 1; eventText: string }
      consumerRevision: string
    }
export type AskProgress =
  'queued' | 'retrieving' | 'preparing' | 'generating' | 'validating' | 'cancelling'
export interface CitedClaim {
  id: string
  text: string
  kind: 'paraphrase' | 'quotation' | 'conflict'
  evidenceIds: string[]
}
export interface PromptEvidenceRange extends EvidenceRange {
  parentRangeId: string
}
export interface PromptInclusion {
  ranges: PromptEvidenceRange[]
  omittedRangeIds: string[]
  budgetComplete: boolean
  inputTokens: number
  contextWindowTokens: number
  outputReserveTokens: number
  safetyMarginTokens: number
  accounting: 'tokenizer'
  wireSha256: string
}
export interface CitedAnswerSnapshot {
  /** Digest of the normalized complete caller descriptor; required for admission. */
  requestSha256?: string
  version: 1
  runId: string
  purpose: CitedAskRequest['purpose']
  askedAt: string
  status: 'answered' | 'conflicting-evidence' | 'no-history' | 'insufficient-evidence'
  claims: CitedClaim[]
  evidence: EvidenceBundle
  prompt: PromptInclusion | null
  engineId: string | null
  modelArtifactRevision: string | null
  promptVersion: 1 | typeof CITED_ASK_PROMPT_VERSION
  consumerRevision?: string
}
export type CitedAskResult =
  | { status: 'complete' | 'no-history' | 'insufficient-evidence'; snapshot: CitedAnswerSnapshot }
  | {
      status: 'error'
      code:
        | 'cancelled'
        | 'busy'
        | 'refine-query'
        | 'invalid-subset'
        | 'narrow-history'
        | 'unavailable'
        | 'retrieval-timeout'
        | 'model-absent'
        | 'model-failed'
        | 'question-too-large'
        | 'unsupported-model-budget'
        | 'output-limit'
        | 'invalid-answer'
        | 'stale'
        | 'unauthorized'
      message: string
    }
export type SnapshotValidation =
  | { status: 'valid'; observedAt: string }
  | { status: 'stale' | 'missing' | 'unauthorized' | 'unavailable'; reason: string }
export type CitationView =
  | {
      status: 'resolved'
      passage: SourcePassage
      occurredAt?: string | null
      dateBasis?: 'startedAt' | 'createdAt' | 'unknown'
      range: EvidenceRange
      audio: { status: 'available'; token: string } | { status: 'unavailable' | 'ambiguous' }
    }
  | Exclude<SnapshotValidation, { status: 'valid' }>

/** Returned only after a fresh main-owned citation/audio token validation. */
export interface CitedAudioPlayback {
  bytes: Uint8Array
  mime: string
  seekSeconds: number
}
