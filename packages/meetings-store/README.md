# Portable meeting storage and derived source retrieval

JSON/audio remain authoritative. DEV-506 adds a lexical source contract and an on-demand desktop worker cache. It does not replace the existing Home search or Global Ask UI; DEV-507 consumes the new interface.

DEV-507 adds `evidence-contract` and `evidence` exports plus worker/client
`retrieveEvidence`, `validateEvidence`, `census` and cited-only
`resolveAcknowledged`. It ranks original personal/transcript ranges, retains
complete requested-domain scans and manifests, and separates bounded evidence
from literal counts. The legacy source APIs below keep their behavior. See
[cited Ask](../../docs/cited-ask.md) for limits, consumer lifecycle and the
production-off acceptance gate. Performance measurements and original results
remain in `docs/qa/dev507`; earlier DEV-506 numbers are not current acceptance.

## Consumer contract

Types live at `@repo/meetings-store/source-contract`. Desktop exposes `window.sources.search(query, limit?)`, `.resolve(anchor)`, `.state()` and `.cancel()`. Main selects the library; renderer input cannot select a path, account or workspace. The worker owns all enumeration, parsing, hashing, reconciliation and SQLite work. `SourceIndexClient` supports `AbortSignal` for non-renderer consumers.

A source anchor has `version: 1`, `libraryId`, nullable `accountId`/`workspaceId`, `meetingId`, `revisionId`, `sourceId` and `kind` (`title`, `personal`, `transcript`, `summary`). These are JSON values, not paths. The original transcript segment ID is retained as `transcript:<id>`; legacy missing IDs use revision-bound positional IDs. Personal lines use `personal:<line-index>`. Text imports do not gain fabricated audio times.

`revisionId` is SHA-256 over the projected document, including text, speaker/timing, retained revision metadata and selected summary identity. External edits that omit revision metadata still invalidate anchors. Transcript labels use the canonical participant roster before cached segment labels, with the existing name sanitization and channel defaults. A participant-only factual label correction therefore changes the projected revision and makes old anchors stale; reconciliation refreshes the disposable cache without rewriting originals. Unlike mobile's immutable UUID revision history, this derived revision identifies the current portable projection; the index does not retain deleted source versions. Resolution always rereads the original and returns `resolved`, `stale`, `missing`, `unauthorized` or `unavailable`. Consumers must resolve an anchor again before using/showing its evidence, and must not substitute a newer revision for a stale citation.

Local originals have null account/workspace identity regardless of sign-in. Optional additive `MeetingRecord.sourceScope` represents explicit ownership for future trusted producers; the normalizer retains it and renderer updates cannot set/clear it. Bound records are excluded from the local desktop retrieval scope and all local MCP tools. A trusted explicit scope can use the shared projection API; no account-bound desktop selector or cloud fallback is implemented here. Invalid ownership is unavailable, never converted into local ownership.

The desktop worker exclusively creates `meetings/.doodlenote-source-library.json` with a random library ID, mode 0600 and atomic exclusive publication. Existing relocation copies the entire meetings directory, preserving the ID without moving the derived cache. This small additive identity file does not migrate or rewrite a meeting. A malformed identity fails closed and is never silently replaced. Read-only MCP never creates it: legacy libraries use a path-derived identity until desktop initializes the sidecar. Such legacy anchors become unauthorized when the identity/path changes; clients must search again. Copies retaining a sidecar represent copies of the same library, not independent identities. Do not delete the sidecar to reset the cache.

## Eligibility, coverage and freshness

Search covers every eligible JSON original, regardless of age, segment position or summary availability. It includes title, personal lines, non-echo transcript passages and selected summary text (or legacy enhanced text when no selected version exists). Missing selected summaries report incomplete coverage and do not silently fall back to an obsolete enhanced version. Without a selected summary, absent/null legacy `enhancedMarkdown` means no summary; a nonstring value adds unavailable coverage while valid passages remain searchable. A selected summary takes precedence over the unused legacy field. Richer/unknown original fields are not modified by indexing. This is a projection of portable desktop JSON, not a native mobile schema migration or a fix for unrelated sync normalization.

Query semantics are case/diacritic-insensitive literal substrings, whitespace-separated terms ANDed within a passage. No SQL/FTS operators are accepted as operators. All text is retained; no newest-30 or 1,500-character cutoff. Empty queries return no hits. Limits are 1–1,000 (default 50). Order is deterministic meeting/source identity, not relevance ranking.

Each query reconciles the full source set before publishing. SQL rows for unchanged revisions are retained; edited/removed/ineligible rows are replaced/deleted in one transaction. Original-file fingerprints are checked again before returning: concurrent edits/deletes/imports remove changed hits and make coverage incomplete. Corrupt, malformed, duplicate-source-ID, unreadable and symlink originals are unavailable, never a complete empty success. An unavailable directory fails the request.

Results contain `freshness: "reconciled"`, a request `generation`, `eligibleMeetingCount`, `matchedMeetingCount`, `matchedSourceCount`, `unavailableCount`, `countsAreComplete` and `isExhaustive`. Counts describe the observed reconciliation, not an atomic historical snapshot. `countsAreComplete` is false if originals changed or were unavailable; `isExhaustive` additionally requires no truncation. Do not turn a top-k result into an exhaustive claim. Worker state (`starting`, `dirty`, `reconciling`, `ready`, `unavailable`, `closed`) reports activity, not permanent freshness: externally edited originals are reconciled again on every query.

Desktop writes invalidate the generation and atomically cancel pending jobs. Live relocation retires the old worker before starting a replacement against the active originals, preserving one SQLite writer. Pending requests, requests waiting for retirement and delayed responses are fenced; cancellation does not wait for retirement. Its IPC handler bypasses the library relocation barrier and only invalidates in-memory jobs/atomic flags, so it can release a query that relocation is draining. Search and resolution remain behind that barrier; the existing Electron IPC sender handling is unchanged. The trusted path is read again for every operation and response, including when a relocation callback is missed. An unavailable active volume never falls back to the retained recovery copy. Account/path/authorization changes are checked before delivering every result. Cancellation flags are checked while scanning and updating; transactions roll back on cancellation. No response from a cancelled generation is delivered. Abrupt worker/process termination may leave a partial cache transaction, which SQLite rolls back; originals are only read. The worker can finish a bounded SQLite call before observing cancellation. After a worker crash the source endpoint is unavailable until restart; ordinary recording/persistence remains independent.

## SQLite and local MCP compatibility

The cache is `userData/derived-source-index/sources-v1.sqlite`, with WAL and a busy timeout. It is outside the portable library and there is one writer in the app's existing single-instance desktop profile. Missing/corrupt SQLite caches rebuild from originals on restart/query. The cache filename/schema are versioned and disposable. Rollback removes only the cache directory while desktop is closed; preserve all JSON/audio and the identity sidecar. Derived text has the same sensitivity as original meeting text; this is not encryption at rest.

No dependency or lockfile change is needed. Electron 44.0.0 actually tested here embeds Node 24.18.1 and SQLite 3.53.1; `node:sqlite`, FTS5 unicode61 and trigram work in its worker. The emitted worker also ran from an ASAR archive inside an isolated native Electron app process. Host tests use Node 24.22.0 / SQLite 3.53.4; the SQLite worker requires Node >=22.13 outside Electron. See [Node SQLite documentation](https://nodejs.org/download/release/latest-v22.x/docs/api/sqlite.html) and [Electron 44 release](https://www.electronjs.org/blog/electron-44-0).

Trigram was chosen to preserve literal infix searches, accent normalization and short/CJK queries. unicode61 is faster/smaller but does not match `aunch` inside `launch`. Trigram candidates are followed by the shared literal predicate; terms shorter than three code points use a scan. Measurements are in [the DEV-506 benchmark report](../../docs/reviews/dev-506-derived-index.md). There is no embedding/model/network requirement.

Local MCP exposes additive local-only `search_meeting_sources` and `resolve_meeting_source` tools. Hosted tool registration is unchanged. MCP scans originals with the same projection, lexical predicate, anchors, coverage and eligibility rules; it never opens/writes SQLite or the identity file. This avoids a second writer, WAL sidecar permissions and native ABI packaging, and works while desktop is closed. Existing transcript responses add optional `segment_id` without removing fields or changing schema version. The built CLI passed an actual Node 18.20.8 stdio test. Large scans block that separate MCP process; they do not run in desktop main. Consent and relocated paths are reloaded for each request.

## Verification and remaining gates

```sh
pnpm install --frozen-lockfile
pnpm --filter @repo/meetings-store test
pnpm --filter @repo/meetings-store typecheck
pnpm --filter doodle-note-mcp test
pnpm --filter doodle-note-mcp typecheck
pnpm --filter desktop test
pnpm --filter desktop typecheck
pnpm --filter desktop build
pnpm --filter doodle-note-mcp build
pnpm lint
pnpm audit --prod --audit-level=low
pnpm --filter @repo/meetings-store exec tsx scripts/benchmark-sources.ts
env -u ELECTRON_RUN_AS_NODE pnpm --filter desktop exec electron scripts/source-index-smoke.cjs
npx --yes --package=node@18.20.8 node packages/doodle-note-mcp/scripts/source-smoke.mjs
```

Tests use only synthetic fixtures. The native runtime/ASAR smoke is not installed capture QA, signing, updater, native Windows, or real-meeting acceptance. Human review, CI/CodeQL and isolated packaged macOS capture/restart/relocation QA remain required; Windows follows native QA. No merge or release is performed by this lane.
