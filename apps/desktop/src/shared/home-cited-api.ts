import type {
  EvidenceFilters,
  CensusRequest,
  CensusResult
} from '@repo/meetings-store/evidence-contract'
import type {
  AskProgress,
  CitedAnswerSnapshot,
  CitedAskResult,
  CitationView,
  CitedAudioPlayback
} from './cited-ask-api'
export const HOME_CITED_STATUS = 'cited-ask:status'
export const HOME_CITED_ASK = 'cited-ask:ask'
export const HOME_CITED_CANCEL = 'cited-ask:cancel'
export const HOME_CITED_HISTORY = 'cited-ask:history'
export const HOME_CITED_CLEAR = 'cited-ask:clear'
export const HOME_CITED_RESOLVE = 'cited-ask:resolve'
export const HOME_CITED_PLAY = 'cited-ask:play'
export const HOME_CITED_CENSUS = 'cited-ask:census'
export const HOME_CITED_PROGRESS = 'cited-ask:progress'
export const HOME_CITED_CHANGED = 'cited-ask:changed'
export interface HomeCitedRequest {
  runId: string
  question: string
  filters: EvidenceFilters
}
export type HomeCitedResult =
  | Extract<CitedAskResult, { status: 'error' }>
  | {
      status: 'complete' | 'no-history' | 'insufficient-evidence'
      snapshot: CitedAnswerSnapshot
      saved: boolean
      saveError?: string
    }
export type HomeCitedEntry = { id: string; question: string; askedAt: string } & (
  | { status: 'valid'; snapshot: CitedAnswerSnapshot }
  | { status: 'legacy'; answer: string }
  | { status: 'stale' | 'missing' | 'unauthorized' | 'unavailable'; reason: string }
)
export interface HomeCitedApi {
  status(): Promise<{ enabled: boolean }>
  ask(request: HomeCitedRequest): Promise<HomeCitedResult>
  cancel(runId: string): Promise<void>
  history(): Promise<{ entries: HomeCitedEntry[]; error?: string }>
  clear(): Promise<void>
  resolve(entryId: string, evidenceId: string): Promise<CitationView>
  play(entryId: string, evidenceId: string, token: string): Promise<CitedAudioPlayback>
  census(request: CensusRequest): Promise<CensusResult>
  onProgress(listener: (event: { runId: string; phase: AskProgress }) => void): () => void
  onChanged(listener: () => void): () => void
}
