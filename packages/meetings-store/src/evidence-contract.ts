/** Additive original-evidence contracts; no original or v1 anchor migration. */
import type { SourceScope, SourceAnchor } from './source-contract'
export type EvidenceFilters = { folderId?: string; dateFrom?: string; dateBefore?: string }
export type EvidenceSelection =
  | { mode: 'question'; question: string; filters: EvidenceFilters; meetingIds?: string[] }
  | { mode: 'linked-history'; meetingIds: string[]; topic?: string }
export type EvidenceRange = {
  id: string; anchor: SourceAnchor; startUtf16: number; endUtf16: number; quote: string
} // kind must be personal/transcript; id hashes anchor+range+exact quote
export interface EvidenceCoverage {
  version: 1; scope: SourceScope; observedAt: string; selection: EvidenceSelection
  terms: string[]; phrases: string[]; droppedTerms: string[]
  eligibleMeetingCount: number; scannedMeetingCount: number; matchingMeetingCount: number
  matchingSourceCount: number; candidateWindowCount: number; selectedMeetingCount: number
  selectedRangeIds: string[]; unavailableCount: number; unknownDateCount: number
  scanComplete: boolean; selectionComplete: boolean; semanticCoverage: 'not-exhaustive'
  omissions: Array<'query-terms'|'candidate-cap'|'range-cap'|'meeting-cap'|
    'unavailable'|'changed-during-scan'|'unknown-date'|'linked-sampling'>
}
export interface SourceDependency {
  meetingId: string; rawSha256: string; projectedRevisionId: string
  filterMetadataSha256: string
}
export interface EvidenceManifest {
  version: 1; scope: SourceScope; pathBindingSha256: string
  selection: EvidenceSelection; plannerVersion: 1
  inventorySha256: string; dependencies: SourceDependency[]
  selectionSha256: string; coverageSha256: string
}
export interface EvidenceMeetingMeta {
  meetingId: string; title: string; occurredAt: string | null
  dateBasis: 'startedAt'|'createdAt'|'unknown'
}
export interface EvidenceBundle {
  version: 1; ranges: EvidenceRange[]; meetings: EvidenceMeetingMeta[]
  coverage: EvidenceCoverage; manifest: EvidenceManifest
}
export type CensusRequest = { filters: EvidenceFilters; predicate:
  { kind: 'eligible' } | { kind: 'literal'; text: string } }
export interface CensusResult {
  scope: SourceScope; predicate: CensusRequest; meetingCount: number; sourceCount: number
  exact: boolean; unavailableCount: number; unknownDateCount: number
  meetings: Array<{ meetingId: string; title: string }>; listTruncated: boolean
}
