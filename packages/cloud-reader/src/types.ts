export interface ReaderNote {
  id: string;
  libraryId: string;
  title: string;
  state: "active" | "trashed" | "purged";
  contentRevision: string | null;
  headRevision: string;
  generation: string;
  deletionId: string | null;
  expiresAt: string | null;
}
export interface ReaderVersion {
  id: string;
  kind: string;
  createdAt: string;
}
export interface ReaderDetail {
  note: ReaderNote;
  versions: ReaderVersion[];
  next: string | null;
  selectedRevision: string | null;
  snapshot: unknown;
}
export interface ReaderAction {
  kind: "choose" | "trash" | "restore" | "purge";
  libraryId: string;
  noteId: string;
  operationId: string;
  expectedRevision: string;
  expectedLifecycleGeneration: string;
  selectedRevision?: string;
  deletionId?: string;
}
export interface ReaderQuery {
  noteId?: string;
  revisionId?: string;
  after?: string;
}
export interface ReaderTransport {
  list(after?: string): Promise<{ notes: ReaderNote[]; next: string | null }>;
  detail(query: ReaderQuery): Promise<ReaderDetail>;
  action(value: ReaderAction): Promise<{ status: string }>;
  preview(
    note: ReaderNote,
    revision: string,
    version: string,
  ): Promise<Uint8Array>;
}
