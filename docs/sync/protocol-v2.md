# ONY-258: opt-in versioned synchronization

Status: source implementation for review. No production migration, rollout flag, secret, client upgrade or live data mutation has been performed. Source deployment does not activate v2.

## Wire and compatibility

Enable only after migration `0013_same_abomination.sql` and staged verification: `DOODLENOTE_SYNC_V2_ENABLED=true` plus a server-only `DOODLENOTE_SYNC_CURSOR_SECRET` of at least 32 characters, provisioned through the approved secret manager. An absent/false flag returns 404 before the v2 route initializes the database. Missing secret fails closed. Existing bearer-device authentication and paid-sync entitlement checks apply to every enabled request. Workspace identity comes exclusively from the authenticated device, never request JSON.

`GET /api/sync/v2` returns protocol version, capabilities and limits. `POST /api/sync/v2` accepts `{operations: [...]}`; the complete streamed request is bounded to 2,000,000 bytes and 20 items. Each operation is independently atomic. Successful siblings survive invalid/rejected siblings; retry the exact failed/unacknowledged operations with their original IDs. An operation contains:

- All UUID identity strings must be canonical lowercase, including nested source/summary/speaker/attachment IDs. The native adapter lowercases UUID serialization; uppercase aliases are rejected before hashing/storage to preserve immutable identity.
- `protocolVersion: 2`, `libraryId`, `noteId`, `operationId`: explicit UUID identities.
- `expectedRevision`: last acknowledged cloud content revision UUID, null only for first creation/concurrent first-create. Arbitrary or foreign-note base revisions are rejected.
- `expectedLifecycleGeneration`: independent opaque lifecycle generation. This changes for Trash/restore/purge and cannot be inferred from a content timestamp or revision. Initial creation uses null.
- `kind`: `upsert`, `trash`, `restore` or `purge`. Only upsert contains `snapshot`. Restore and purge require the current `deletionId`; every lifecycle mutation requires current content and lifecycle preconditions. Purge requires Trash.

`SyncSnapshot` and strict validation live in `packages/db/src/sync-contract.ts`. Unsupported fields are rejected recursively; no generic extension object, embedded audio, voice embeddings, API credential or arbitrary blob URL is accepted. Ink is represented only by attachment/version IDs; actual private asset ownership, storage and readers are ONY-259/261. No audio data is transferred.

| Native ONY-242 domain | v2 mapping |
|---|---|
| LibraryIdentity + LibraryRecord | Bearer workspace authorization plus explicit library UUID. First note creates that workspace-owned library; IDs cannot move across workspaces/libraries. Local-only library is not automatically uploaded |
| NoteRecord title/text/language/passages | Snapshot retains original text and stable passage UUIDs; millisecond ranges are source-audio offsets, not wall-clock playback guesses |
| NoteMetadata.revisionID | `sourceRevisionId`, distinct from server synchronization head revision |
| NoteRevision | `sourceVersions[]` retains immutable title, typed text, passages and speaker annotation data needed by source anchors. Current source version must exactly match current content |
| SourceAnchor | Explicit library/note/revision plus `personalParagraph` zero-based newline index or `transcript` passage UUID. Every referenced source revision/content must be in the snapshot's immutable source bundle |
| SummaryVersion | UUID, optional parent UUID, createdAt, generated/edited origin, format, language, markdown and full source anchors; selected summary UUID retained. Missing parents, cycles, dangling sources and foreign scope rejected |
| SpeakerAnnotations | Stable speaker UUIDs, ordered speaker array, optional session UUID/slot and time-aligned provisional/final turns. Adapter must persist a stable session-slot-to-UUID mapping; calendar names do not establish identity |
| EventOccurrenceKey / folder | Provider/account/calendar/event/original-occurrence fields preserved. Optional folder must reference an existing folder owned by this workspace; library-specific folder presentation remains a client adapter concern |
| Ink | Attachment UUID/version references; drawing bytes/private storage contract follows in ONY-259 |

A snapshot must include sources needed by its summaries even when the cited typed text is older than current text. Existing version IDs cannot be changed in later snapshots. Prior cloud snapshots remain immutable until permanent deletion. The explicit payload/20,000-passage limits reject oversized histories instead of truncating them. A future chunk-upload protocol is required for larger snapshots; clients must surface the error and preserve local originals. Do not silently prune history or original text to fit the limit.

## Conflicts, replay and ordering

The database function `sync_apply` runs each operation as one PostgreSQL statement/transaction, supported by the existing Neon HTTP driver and PGlite. A workspace clock row serializes mutation commit order. Opaque revision UUIDs identify content; monotonically allocated sequence values order the feed. Gaps from rejected operations are harmless. Unlike timestamps, equal wall-clock times cannot skip a change.

An upsert based on a known stale content revision stores the complete alternate snapshot as an immutable `conflict` revision and leaves the accepted head unchanged. Conflict revisions appear in the feed. Resolving a conflict means sending the chosen/merged full snapshot with a new operation ID, current head and lifecycle generation; retained sources and summaries remain immutable. Stale lifecycle state cannot create a hidden alternate active note.

Operation receipts are bound to organization, note and canonical payload SHA-256. Exact retry returns the same receipt; reusing an operation UUID for different content is rejected. Receipts contain only identifiers, state, timestamps and sequence, never note text. After purge, replay returns `purged`, not an old active result.

`GET /api/sync/v2?libraryId=UUID[&cursor=opaque]` returns ordered revision events, `hasMore`, and a new cursor. The HMAC-signed cursor binds version, organization, library and sequence; another library/workspace or a modified cursor is rejected. Pull currently limits 20 revisions per page (each accepted snapshot is bounded by the request limit). Persist cursor only after every event is durably applied. Retry the page after an interrupted local transaction. Fresh clients begin without a cursor and receive retained history/tombstones, not an unbounded allIds deletion inference. Empty pages preserve the existing position.

Legacy payloads and timestamps are not used as v2 cursors. On adoption of an existing meeting, the server captures the complete meeting row, note envelopes and all segments into an immutable `legacy` revision before preserving the incoming mobile candidate as a conflict. A client must resolve that initial comparison explicitly. No old data is silently converted away. Existing clients retain their old endpoints; migrated database triggers reject legacy writes/deletes to protected IDs, including direct note/segment writes. Legacy delete batches with any rejection return HTTP 409 because installed clients clear their pending queue on HTTP success. Retried already-deleted siblings are harmless.

The legacy push path rejects oversized/invalid segments rather than silently filtering or taking only the first 5,000. With v2 rollout enabled it uses an atomic full-item SQL function and ownership guards. Before migration/while disabled, the old schema path remains available with validation and race-safe ownership upsert. Its historical multi-statement legacy replacement remains a rollback limitation; do not resume rich-data writes through it. Triggers remain installed during an application rollback to protect adopted records. Legacy timestamps on subsequent writes are made strictly increasing per workspace at millisecond precision; pre-existing timestamp ties are not a v2 migration cursor and require an explicit client full refresh when adopting v2.

## Trash, expiry and purge

State is `active`, `trashed` or `purged`. Trash assigns server deletion UUID, server deletedAt and 30-day expiresAt; user device clocks cannot extend server retention. Restore is explicit before expiry and requires matching deletion identity, content revision and lifecycle generation. Local provisional clocks from ONY-260 must be reconciled with these acknowledged server values by ONY-262. Removing downloaded audio remains local and does not change cloud lifecycle.

Expiry processing occurs when the service handles applicable writes or library pulls; each pull cleans up at most 50 expired notes. All expired snapshot payloads are withheld even while bounded cleanup continues. There is no claim of execution while the service is idle. A periodic cleanup schedule requires a separately authorized operational rollout if wall-clock physical erasure at the deadline is required. Restoring expired content is forbidden even before cleanup has run.

Purge nulls every retained snapshot/conflict payload, removes any legacy projection and keeps minimal note/revision/operation identity receipts to reject stale clients permanently. Attachment-object cleanup follows ONY-259 and must be completed in rollout before storing ink. Old legacy deletions also create durable barriers; an offline client cannot recreate the same ID. A deliberate new local copy must use a new note identity and explicit sync selection, never spoof a restore.

The existing personal-billing purge service detects the installed purge function through the PostgreSQL catalog, so it works both before migration and during flag-off rollback. It erases native-only and adopted personal records/history while retaining minimal barriers. Shared-workspace data remains untouched. Organization deletion cascades cleanly without triggers recreating data. No HTTP endpoint exposes workspace-wide purge.

## Migration, rollback and verification

1. Back up the target database and test restore in an isolated staging environment. Record row counts/hashes and representative old-client fixtures. No production commands are run by this PR.
2. Deploy source with v2 flag absent. Validate existing clients against the old schema. Provision the cursor secret only through normal protected configuration, never commit it.
3. Apply the additive migration in an approved maintenance stage. It adds tables/functions/guards without rewriting existing note/segment data. Legacy content is snapshotted lazily and atomically at adoption; default legacy tombstone libraries are deterministically named from workspace identity.
4. Validate isolated mixed-client adoption, old edits rejected, complete long transcript transfer, two offline edits, repeated operation, multi-page pull, Trash/restore, expiration, permanent deletion and personal billing purge. Only then enable v2 for the intended environment and compatible client rollout. ONY-261/262 readers/adapters must follow before users rely on new data presentation.
5. Application rollback: turn the v2 flag off; retain additive schema, guards and purge adapter. Do not drop tables/functions/receipts after v2 writes because that would lose history and permit resurrection. A schema down-migration is safe only before any adoption/write and with verified backup; otherwise prefer a forward fix. No automatic destructive down script is supplied.

Commands from the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @repo/db test
pnpm --filter @repo/db typecheck
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter web build
python3 packages/db/scripts/verify-sync-postgres.py
```

The Python command uses local PostgreSQL binaries (default `/opt/homebrew/bin`, configurable via `POSTGRES_BIN`), a disposable `/tmp` cluster and private Unix socket with TCP disabled. It never reads DATABASE_URL and stops/deletes the cluster on completion. It tests rollback/reapply plus genuinely concurrent cross-workspace library creation and stale-base edits. PGlite integration tests exercise the real migration/functions, 6,001-segment final-sentinel round trips, replay, conflicts, strict source anchors, purge and organization cascade. Web tests exercise signed cursor isolation, per-item failures, bounded bodies, disabled v2 without a database, and old-client DELETE failure semantics.

Check this: use only a disposable test workspace. Edit the same note offline in two clients; both versions must appear. Retry the same operation; no duplicate revision should appear. Trash then restore with the exact deletion generation; after purge, replay must return purged and all payloads must be absent. Try the cursor in another library; expect a sanitized rejection. Review old-client upgrade messaging in ONY-261/262 before rollout.
