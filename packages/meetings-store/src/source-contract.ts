/** Additive v1 retrieval contract. Originals, not the cache, decide eligibility. */
export interface SourceScope {
  libraryId: string;
  /** null denotes account-independent local originals, never the signed-in account. */
  accountId: string | null;
  workspaceId: string | null;
}

export interface SourceAnchor extends SourceScope {
  version: 1;
  meetingId: string;
  /** SHA-256 of the projected document; changes even when an external editor omits revision metadata. */
  revisionId: string;
  sourceId: string;
  kind: "title" | "personal" | "transcript" | "summary";
}

export interface SourcePassage {
  anchor: SourceAnchor;
  title: string;
  text: string;
  speaker?: string;
  startMs?: number;
  endMs?: number;
}

export interface SourceSearchResult {
  scope: SourceScope;
  generation: number;
  /** Returned only after worker reconciliation; never cached results from a pending rebuild. */
  freshness: "reconciled";
  hits: SourcePassage[];
  eligibleMeetingCount: number;
  matchedMeetingCount: number;
  matchedSourceCount: number;
  unavailableCount: number;
  countsAreComplete: boolean;
  isExhaustive: boolean;
}

export type SourceResolution =
  | { status: "resolved"; passage: SourcePassage }
  | { status: "missing" | "stale" | "unauthorized" | "unavailable" };

export interface SourceContext {
  meetingsDir: string;
  scope: SourceScope;
  authorized: boolean;
}
