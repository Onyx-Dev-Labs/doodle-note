import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  normalizeParticipants,
  sanitizeSpeakerName,
  speakerLabel,
} from "./speakers";
import type {
  SourceAnchor,
  SourceContext,
  SourcePassage,
  SourceResolution,
  SourceScope,
  SourceSearchResult,
} from "./source-contract";

const ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
export const SOURCE_IDENTITY_FILE = ".doodlenote-source-library.json";
export const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
export const sameScope = (a: SourceScope, b: SourceScope): boolean =>
  a.libraryId === b.libraryId &&
  a.accountId === b.accountId &&
  a.workspaceId === b.workspaceId;
export const normalizeSearch = (value: string): string =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
export function searchTerms(query: string): string[] {
  if (typeof query !== "string" || query.length > 4096)
    throw new Error("Invalid source query");
  return normalizeSearch(query).trim().split(/\s+/u).filter(Boolean);
}
export function sourceLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid source limit");
  return limit;
}

/** Only the desktop worker creates this identity. MCP never writes, even on old libraries. */
export function localSourceScope(
  meetingsDir: string,
  create = false,
): SourceScope {
  const file = join(meetingsDir, SOURCE_IDENTITY_FILE);
  try {
    const identity: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      !object(identity) ||
      identity.version !== 1 ||
      typeof identity.libraryId !== "string" ||
      !ID.test(identity.libraryId)
    )
      throw new Error("Invalid source library identity");
    return {
      libraryId: identity.libraryId,
      accountId: null,
      workspaceId: null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!create)
    return {
      libraryId: `legacy-${digest(realpathSync(meetingsDir))}`,
      accountId: null,
      workspaceId: null,
    };
  mkdirSync(meetingsDir, { recursive: true });
  const temporary = join(meetingsDir, `.source-${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ version: 1, libraryId: randomUUID() }));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    // Atomic, exclusive publication: never overwrite a concurrent writer's identity.
    try {
      linkSync(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    unlinkSync(temporary);
  }
  return localSourceScope(meetingsDir);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
export interface SourceDocument {
  meetingId: string;
  revisionId: string;
  passages: SourcePassage[];
  unavailableCount: number;
}

/** Reads a projection; never normalizes/writes the original or strips richer synced fields. */
export function projectSources(
  raw: unknown,
  scope: SourceScope,
): SourceDocument | null {
  if (!object(raw) || typeof raw.id !== "string" || !ID.test(raw.id))
    throw new Error("Invalid meeting");
  if (raw.trashedAt != null) {
    if (
      typeof raw.trashedAt !== "string" ||
      !Number.isFinite(Date.parse(raw.trashedAt))
    )
      throw new Error("Invalid trash state");
    return null;
  }
  if (
    (raw.title !== undefined && typeof raw.title !== "string") ||
    (raw.rawNotesMarkdown !== undefined &&
      typeof raw.rawNotesMarkdown !== "string")
  )
    throw new Error("Invalid source text");
  // Future account-bound originals must carry explicit ownership. Legacy originals are local.
  if (raw.sourceScope !== undefined) {
    const owner = raw.sourceScope;
    if (
      !object(owner) ||
      typeof owner.libraryId !== "string" ||
      !owner.libraryId ||
      !(
        (owner.accountId === null && owner.workspaceId === null) ||
        (typeof owner.accountId === "string" &&
          !!owner.accountId &&
          typeof owner.workspaceId === "string" &&
          !!owner.workspaceId)
      )
    )
      throw new Error("Invalid source ownership");
    if (!sameScope(owner as unknown as SourceScope, scope)) return null;
  } else if (scope.accountId !== null || scope.workspaceId !== null)
    return null;
  const title = string(raw.title);
  type Draft = Omit<SourcePassage, "anchor"> & {
    kind: SourceAnchor["kind"];
    sourceId: string;
  };
  const passages: Draft[] = [];
  const add = (
    kind: SourceAnchor["kind"],
    sourceId: string,
    text: string,
    extra: Partial<Draft> = {},
  ): void => {
    if (text.trim()) passages.push({ kind, sourceId, title, text, ...extra });
  };
  add("title", "title", title);
  string(raw.rawNotesMarkdown)
    .split("\n")
    .forEach((text, i) => add("personal", `personal:${i}`, text));
  const participants = normalizeParticipants(raw.participants);
  const seen = new Set<string>();
  if (raw.segments !== undefined && !Array.isArray(raw.segments))
    throw new Error("Invalid transcript");
  for (const [i, segment] of (Array.isArray(raw.segments)
    ? raw.segments
    : []
  ).entries()) {
    if (!object(segment) || typeof segment.text !== "string")
      throw new Error("Invalid passage");
    if (segment.echo) continue;
    const id =
      typeof segment.id === "string" && segment.id
        ? `transcript:${segment.id}`
        : `legacy-transcript:${i}`;
    if (seen.has(id)) throw new Error("Ambiguous source identity");
    seen.add(id);
    add("transcript", id, segment.text, {
      // Match the canonical reader: participants override the sanitized cached
      // label; missing/unknown channels use the existing far-side default.
      // Narrow raw values before helpers that expect typed strings.
      speaker: speakerLabel(
        {
          channel:
            segment.channel === "mic" || segment.channel === "text"
              ? segment.channel
              : "system",
          speaker:
            typeof segment.speaker === "string"
              ? sanitizeSpeakerName(segment.speaker)
              : "",
          ...(typeof segment.speakerId === "string"
            ? { speakerId: segment.speakerId }
            : {}),
        },
        participants,
      ),
      ...(typeof segment.startMs === "number" &&
      Number.isFinite(segment.startMs)
        ? { startMs: segment.startMs }
        : {}),
      ...(typeof segment.endMs === "number" && Number.isFinite(segment.endMs)
        ? { endMs: segment.endMs }
        : {}),
    });
  }
  // Retained selected-summary metadata is supported without flattening it into enhancedMarkdown.
  const metadata = object(raw.metadata) ? raw.metadata : undefined;
  let unavailableCount = 0;
  if (metadata?.selectedSummaryID != null) {
    const summary = Array.isArray(metadata.summaries)
      ? metadata.summaries.find(
          (s) => object(s) && s.id === metadata.selectedSummaryID,
        )
      : undefined;
    if (object(summary) && typeof summary.text === "string")
      add("summary", `summary:${string(summary.id)}`, summary.text);
    else unavailableCount++;
  } else if (raw.enhancedMarkdown == null) {
    // Older originals may omit the summary or explicitly store null.
  } else if (typeof raw.enhancedMarkdown === "string") {
    add("summary", "summary:enhanced", raw.enhancedMarkdown);
  } else unavailableCount++;
  const revisionId = digest(
    JSON.stringify({
      passages,
      revision: metadata?.revisionID ?? null,
      selected: metadata?.selectedSummaryID ?? null,
    }),
  );
  return {
    meetingId: raw.id,
    revisionId,
    unavailableCount,
    passages: passages.map(({ kind, sourceId, ...p }) => ({
      ...p,
      anchor: {
        ...scope,
        version: 1,
        meetingId: raw.id as string,
        revisionId,
        sourceId,
        kind,
      },
    })),
  };
}

export interface SourceSnapshot {
  documents: SourceDocument[];
  unavailableCount: number;
  fingerprints: Map<string, string | null>;
  /** Additive scan facts. Never included in the existing v1 projection hash. */
  inventory: Map<string, { rawSha256: string; state: 'eligible' | 'excluded' | 'unavailable';
    title: string; occurredAt: string | null; dateBasis: 'startedAt' | 'createdAt' | 'unknown'; folderId: string | null }>;
  requestedIds?: string[];
}
function fingerprint(path: string): string {
  const info = lstatSync(path, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Not an original file");
  return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}
const sourceFiles = (directory: string): string[] =>
  readdirSync(directory)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .sort();
export function scanSources(
  context: SourceContext,
  checkpoint: () => void = () => {},
  requestedIds?: string[],
): SourceSnapshot {
  if (!context.authorized) throw new Error("Source scope is unauthorized");
  const documents: SourceDocument[] = [];
  let unavailableCount = 0;
  const fingerprints = new Map<string, string | null>();
  const inventory: SourceSnapshot["inventory"] = new Map();
  // Directory failures are errors, never a successful empty/exhaustive library.
  for (const file of requestedIds ? requestedIds.map(id => `${id}.json`) : sourceFiles(context.meetingsDir)) {
    checkpoint();
    fingerprints.set(file, null);
    try {
      const path = join(context.meetingsDir, file);
      const before = fingerprint(path);
      fingerprints.set(file, before);
      const bytes = readFileSync(path);
      const rawSha256 = createHash('sha256').update(bytes).digest('hex');
      const raw: unknown = JSON.parse(bytes.toString('utf8'));
      if (!object(raw) || `${raw.id}.json` !== file)
        throw new Error("Filename identity mismatch");
      const doc = projectSources(raw, context.scope);
      if (fingerprint(path) !== before)
        throw new Error("Original changed while reading");
      const validDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
      const dateBasis = validDate(raw.startedAt) ? 'startedAt' : validDate(raw.createdAt) ? 'createdAt' : 'unknown';
      inventory.set(file, { rawSha256, state: doc ? 'eligible' : 'excluded', title: string(raw.title),
        occurredAt: dateBasis === 'unknown' ? null : new Date(raw[dateBasis] as string).toISOString(), dateBasis,
        folderId: typeof raw.folderId === 'string' ? raw.folderId : null });
      if (doc) {
        documents.push(doc);
        unavailableCount += doc.unavailableCount;
      }
    } catch {
      fingerprints.set(file, null);
      inventory.set(file, { rawSha256: '', state: 'unavailable', title: '', occurredAt: null, dateBasis: 'unknown', folderId: null });
      unavailableCount++;
    }
  }
  return { documents, unavailableCount, fingerprints, inventory, ...(requestedIds ? { requestedIds } : {}) };
}

export function changedSourceFiles(snapshot: SourceSnapshot, context: SourceContext): Set<string> {
  const files = new Set(snapshot.requestedIds ? snapshot.requestedIds.map(id => `${id}.json`) : sourceFiles(context.meetingsDir));
  const changed = new Set<string>();
  for (const [file, before] of snapshot.fingerprints) {
    if (before === null) continue; // already counted as unavailable by the scan
    if (!files.has(file)) {
      changed.add(file);
      continue;
    }
    try {
      if (fingerprint(join(context.meetingsDir, file)) !== before)
        changed.add(file);
    } catch {
      changed.add(file);
    }
  }
  for (const file of files)
    if (!snapshot.fingerprints.has(file)) changed.add(file);
  return changed;
}

export function sourceResult(
  snapshot: SourceSnapshot,
  context: SourceContext,
  generation: number,
  hits: SourcePassage[],
  limit: number,
): SourceSearchResult {
  // Atomic JSON writes can happen during a worker scan. Fence changed/deleted rows and
  // expose incomplete counts instead of presenting a mixed snapshot as exhaustive.
  const changed = changedSourceFiles(snapshot, context);
  hits = hits.filter((p) => !changed.has(`${p.anchor.meetingId}.json`));
  const unavailableCount = snapshot.unavailableCount + changed.size;
  hits.sort(
    (a, b) =>
      a.anchor.meetingId.localeCompare(b.anchor.meetingId, "en") ||
      a.anchor.sourceId.localeCompare(b.anchor.sourceId, "en"),
  );
  const visible = hits.slice(0, sourceLimit(limit));
  return {
    scope: context.scope,
    generation,
    freshness: "reconciled",
    hits: visible,
    eligibleMeetingCount: snapshot.documents.length,
    matchedMeetingCount: new Set(hits.map((h) => h.anchor.meetingId)).size,
    matchedSourceCount: hits.length,
    unavailableCount,
    countsAreComplete: unavailableCount === 0,
    isExhaustive: unavailableCount === 0 && hits.length === visible.length,
  };
}
export function searchOriginalSources(
  context: SourceContext,
  query: string,
  limit = 50,
  generation = 0,
): SourceSearchResult {
  const terms = searchTerms(query);
  const snapshot = scanSources(context);
  const hits = terms.length
    ? snapshot.documents
        .flatMap((d) => d.passages)
        .filter((p) => terms.every((t) => normalizeSearch(p.text).includes(t)))
    : [];
  return sourceResult(snapshot, context, generation, hits, limit);
}

/** Resolution always rereads the original; an index hit is not proof of current eligibility. */
export function resolveOriginalSource(
  context: SourceContext,
  anchor: SourceAnchor,
): SourceResolution {
  if (!context.authorized || !anchor || !sameScope(context.scope, anchor))
    return { status: "unauthorized" };
  if (anchor.version !== 1 || !ID.test(anchor.meetingId))
    return { status: "missing" };
  try {
    const file = join(context.meetingsDir, `${anchor.meetingId}.json`);
    if (lstatSync(file).isSymbolicLink()) return { status: "unavailable" };
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!object(raw) || raw.id !== anchor.meetingId)
      return { status: "unavailable" };
    const doc = projectSources(raw, context.scope);
    if (!doc) return { status: "missing" };
    if (doc.revisionId !== anchor.revisionId) return { status: "stale" };
    const passage = doc.passages.find(
      (p) =>
        p.anchor.sourceId === anchor.sourceId && p.anchor.kind === anchor.kind,
    );
    return passage ? { status: "resolved", passage } : { status: "missing" };
  } catch (error) {
    return {
      status:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : "unavailable",
    };
  }
}
