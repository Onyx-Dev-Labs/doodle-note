import type { AskProgress, CitedAskRequest, CitedAskResult, CitedAnswerSnapshot, SnapshotValidation, CitationView } from '../shared/cited-ask-api';
export type { CitedAskRequest } from '../shared/cited-ask-api';

export interface AskControl {
  ownerId: string; runId: string; signal: AbortSignal
  assertCurrent(): void // caller's event/account/correction fence; throws when changed
  onProgress?(phase: AskProgress): void
}
export interface CitedAskService {
  run(request: CitedAskRequest, control: AskControl): Promise<CitedAskResult>
  validate(snapshot: CitedAnswerSnapshot, currentRequest: CitedAskRequest, control: AskControl): Promise<SnapshotValidation>
  resolveCitation(snapshot: CitedAnswerSnapshot, evidenceId: string, currentRequest: CitedAskRequest, control: AskControl): Promise<CitationView>
  cancel(ownerId: string, runId: string): Promise<void> // resolves after producer cleanup
}
