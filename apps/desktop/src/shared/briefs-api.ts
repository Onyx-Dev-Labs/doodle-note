import type { CalendarInvitee, CalendarProvider } from './calendar-api'
import type { AskProgress, CitedAskResult, CitationView, CitedAudioPlayback } from './cited-ask-api'
import type { EvidenceMeetingMeta } from '@repo/meetings-store/evidence-contract'

export const BRIEFS_INVOKE = 'briefs:invoke'
export const BRIEFS_STATE = 'briefs:state'
export const BRIEFS_WARNING = 'briefs:warning'
export type BriefResult = Exclude<CitedAskResult, { status: 'error' }>
export type BriefState =
  | 'checking'
  | 'review-ready'
  | 'no-history'
  | 'ready'
  | 'stale'
  | 'unavailable'
  | 'context-save-failed'
  | 'cancelled'
  | AskProgress
  | 'error'
export interface BriefPerson extends CalendarInvitee {
  personId: string | null
  personName: string | null
  companyId: string | null
  companyName: string | null
  isSelf: boolean | null
  provenance: 'user' | 'confirmed-rule' | 'unassigned'
}
export interface BriefHistory extends EvidenceMeetingMeta {
  linkIds: string[]
  provenance: string[]
  available: boolean
}
export interface BriefView {
  sessionId: string
  state: BriefState
  runId?: string
  message?: string
  errorCode?: Extract<CitedAskResult, { status: 'error' }>['code']
  revision?: number
  event?: {
    id: string
    subject: string
    startIso: string
    endIso: string
    provider: CalendarProvider
    sourceLabel: string
    lastSyncIso: string | null
    stale: boolean
    roster: { state: 'complete' | 'partial' | 'unknown'; omittedCount: number | null }
  }
  people?: BriefPerson[]
  personChoices?: Array<{ id: string; name: string }>
  companyChoices?: Array<{ id: string; name: string }>
  selectedMeetingIds?: string[]
  historyTotal?: number
  history?: BriefHistory[]
  includeCompany?: boolean
  result?: BriefResult
}
export interface BriefSelection {
  /** Omit to select all current linked history; [] always means no selected history. */
  meetingIds?: string[]
  includeCompany?: boolean
  topic?: string
}
export type BriefEdit =
  | { op: 'create-person' | 'create-company'; name: string }
  | { op: 'bind'; inviteeId: string; personId: string | null; future: boolean }
  | { op: 'exclude'; inviteeId: string; personId: string }
  | { op: 'self'; inviteeId: string; isSelf: boolean }
  | { op: 'company'; personId: string; companyId: string | null }
  | { op: 'rename'; entity: 'person' | 'company'; id: string; name: string }
  | { op: 'unlink'; linkId: string }
export type BriefLinkTarget =
  { kind: 'event' } | { kind: 'person'; personId: string } | { kind: 'company'; companyId: string }
export interface BriefPreview {
  previewId: string
  revision: number
  count: number
  firstDate: string | null
  lastDate: string | null
}
export interface BriefForgetPreview {
  previewId: string
  revision: number
  snapshots: number
  people: number
  companies: number
  changes: number
}
export interface BriefApi {
  available(): Promise<boolean>
  open(eventId: string): Promise<BriefView>
  select(sessionId: string, selection: BriefSelection): Promise<BriefView>
  refresh(sessionId: string): Promise<BriefView>
  generate(sessionId: string, runId: string, selection: BriefSelection): Promise<BriefView>
  edit(sessionId: string, revision: number, change: BriefEdit): Promise<BriefView>
  candidates(sessionId: string, query: string): Promise<EvidenceMeetingMeta[]>
  link(
    sessionId: string,
    revision: number,
    meetingId: string,
    target: BriefLinkTarget
  ): Promise<BriefView>
  previewHistory(
    sessionId: string,
    revision: number,
    inviteeId: string,
    personId: string | null
  ): Promise<BriefPreview>
  applyHistory(sessionId: string, previewId: string): Promise<BriefView>
  previewForget(sessionId: string): Promise<BriefForgetPreview>
  forget(sessionId: string, previewId: string, revision: number): Promise<BriefView>
  citation(sessionId: string, evidenceId: string): Promise<CitationView>
  play(sessionId: string, evidenceId: string, token: string): Promise<CitedAudioPlayback>
  cancel(sessionId: string, runId: string): Promise<void>
  close(sessionId: string): Promise<void>
  onWarning(callback: (message: string) => void): () => void
  onState(callback: (view: BriefView) => void): () => void
}
