# Private editable ink and previews (ONY-259)

This is a source implementation, disabled until an approved rollout. It does not
prove a live private store or a physical Pencil roundtrip. Existing public desktop
`/api/sync/media` attachments retain their existing behavior.

## Provider and rollout boundary

Use the existing Vercel Blob SDK (locked 2.8.0) through `PrivateInkStore` with
`access: private`, a **dedicated** `DOODLENOTE_PRIVATE_INK_TOKEN`, immutable paths,
and origin reads (`useCache: false`). Never use `BLOB_READ_WRITE_TOKEN` as fallback.
A private store is required; a public store cannot be made private by hiding its
URL. No store was created, credentials inspected, or configuration changed.

Official references, checked 2026-09-07:
- [Private storage](https://vercel.com/docs/vercel-blob/private-storage)
- [SDK get/put and private access](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Blob security](https://vercel.com/docs/vercel-blob/security)

The new API additionally requires `DOODLENOTE_PRIVATE_INK_ENABLED=true`, and an
entitled authenticated sync device. Missing private configuration fails closed.
Disabled API requests return 404 before database or storage access. Private-store
URLs, storage paths, provider headers, credentials, and presigned URLs are never
returned to clients. Existing sync entitlement/account isolation applies.

Every download supplies library, note, immutable revision, version, and part.
The server verifies that revision actually references that ready bundle, that it
belongs to the authenticated workspace, and that the note is still recoverable.
It fetches and verifies the bounded bytes, then rechecks revision/lifecycle before
responding. Responses and errors use `Cache-Control: private, no-store, max-age=0`
and `Vary: Authorization`. Download responses use `nosniff` and attachment content
disposition. Provider caching is bypassed. No redirect or conditional 304 bypass
exists. Client code must not send these endpoints through public image optimizers
or save fetched bytes to a shared cache.

## Native wire contract

The adapter in ONY-262 first creates the note through sync v2, then reserves a
bundle with POST `/api/sync/ink`. All UUID values are lowercase canonical strings.
`attachmentId` identifies the drawing within its note; `versionId` is a new global
UUID for each immutable bundle and is also the idempotency key. There is no mutable
object overwrite or separate unbounded extension payload.

```json
{
  "libraryId": "UUID", "noteId": "UUID", "attachmentId": "UUID",
  "versionId": "UUID", "generation": "current lifecycle UUID",
  "expectedRevision": "current content head UUID",
  "ink": {"contentType":"application/x-apple-pencilkit","size":123,"sha256":"64 lowercase hex"},
  "preview": {"contentType":"image/png","size":123,"sha256":"64 lowercase hex"}
}
```

The example uses placeholders, not valid request values. The manifest body is
limited to 4096 bytes. Each part is **1 byte to 3 MiB**, independently uploaded as the
binary PUT body to `/api/sync/ink?versionId=UUID&part=ink` (or `preview`), with its
exact content type. Oversized content fails explicitly; keep the local original
and show a sync error. No truncation, lossy replacement, or original deletion.

Ink is `PKDrawing.dataRepresentation()` from the fresh native app, retained byte
for byte. The server treats that Apple serialization as opaque: MIME, size, and
SHA-256 are validated; server-side PencilKit semantic decoding is not claimed.
Native clients must validate with `PKDrawing(data:)` before replacing their local
version. The preview must be noninterlaced 8-bit RGB or RGBA PNG, at most 4096 on
either side and 4,194,304 total pixels. PNG signature, chunk boundaries/CRC, IHDR,
IEND, and bounded decompressed scanlines are checked. The native adapter should
render/encode this explicit preview format. A bundle associates the preview with
the ink revision; it does not cryptographically prove that the image depicts the
ink. Recording audio and voice profiles have no fields or supported content type.

Reservation requires an existing active note and matching lifecycle generation
and content head. A replay of the exact same reservation is safe even if another
content edit subsequently advances the head. A changed manifest with a reused
version is rejected. New revisions use new UUIDs. Upload success returns only
`pending` or `ready`; both parts must be hash-verified before ready. A provider
"exists" or lost-response retry succeeds only after the existing private bytes
match the manifest hash and size.

After `ready`, commit a normal sync v2 snapshot containing
`inkAttachments: [{id: attachmentId, versionId}]`. A PostgreSQL trigger checks
ready state, note/workspace/library ownership in the same transaction as revision
creation. Invalid references roll back the entire operation, including initial
note/adoption changes. A stale known content revision creates a conflict using
ONY-258 semantics, preserving both bundles. Native conflict resolution must not
replace the original local drawing before the chosen revision is acknowledged.

Download with GET `/api/sync/ink?libraryId=UUID&noteId=UUID&revisionId=UUID&versionId=UUID&part=ink`
or `part=preview`. Pending or unreferenced bundles are not downloadable. Other
accounts, guessed IDs, and a version substituted into an unrelated revision get
no bytes. An authenticated server response is required on every request.

## Retention and durable cleanup

All retained immutable revisions, including conflicts, keep their referenced
bundles. Moving a note to Trash retains those assets through ONY-258's server
30-day window. Explicit restore keeps the same asset versions. Expired Trash
cannot download assets even before physical cleanup runs. Permanent purge and
expiry delete asset metadata and enqueue both paths in the same database
transaction as the lifecycle update. Cascading note/library/organization deletion
also queues paths; the cleanup table deliberately has no cascading foreign key.

Pending and ready-but-unreferenced uploads older than 24 hours are orphans. The
collector filters actionable candidates before its limits and rechecks references
under the same workspace mutex as sync commit. Upload finalization checks the
current lifecycle. An upload finishing after purge remains unreachable and resets
the durable cleanup entry. Minimal path tombstones are retained and re-deleted
daily to reclaim provider writes that finish even after an aborted request. These
tombstones hold no ink/preview bytes or credentials.

The existing hourly billing worker runs ordinary billing work first and isolates
private cleanup errors. Cleanup runs after schema installation even when the API
flag is off, so rollback does not strand queued data. It prioritizes never-deleted
paths over repeated tombstones, processes bounded candidates, reserves time for
each 10-second provider request, and reports pending/failed counts. Multiple calls
may be needed for large purges. Provider failures retry; no false physical-erasure
claim is made from metadata deletion alone. The worker requires the existing
CRON_SECRET authorization and no new schedule is installed by this PR.

Personal billing purge deletes native and adopted assets only for selected
personal workspaces. Shared workspace objects remain. Its durable billing job
stays pending when private cleanup has failures or outstanding work. A workspace
with no private assets never requires private storage credentials. After
organization deletion, the existing hourly worker can still process its queued
paths. Operational checks must distinguish logical access denial, a successful
provider delete acknowledgement, and any provider backup/retention policy.

## Migration, staged verification, and rollback

1. Review this source PR. Merging main automatically deploys web code to Vercel
   Production, including billing cleanup compatibility. The ink API stays disabled
   absent its flag; catalog detection supports the old schema. Merge is a separate
   approval from production schema/storage changes.
2. In a separately authorized isolated workspace, apply migrations through 0014.
   It adds metadata/cleanup tables and triggers/functions, without rewriting public
   attachments. Existing sync snapshots with unresolved ink references require an
   explicit inventory/backfill decision; do not invent asset bytes or URLs. Existing
   desktop/public attachments are not migrated into private ink implicitly.
3. Confirm a private store exists, account ownership, region/retention and actual
   expected cost/caps. Obtain explicit approval before creating a paid store or
   setting production credentials/configuration. Configure its dedicated private
   credential and exercise known synthetic files. A wrong/public store must fail.
4. Enable only for the approved test environment. Verify unauthenticated provider
   URL requests reveal no bytes; API requests are authenticated and never cached
   publicly. Exercise interrupted upload, retry, concurrent edits, Trash/restore,
   expiry, permanent purge, billing purge, and organization deletion. Verify deletion
   directly in that controlled store and the cleanup queue, not merely by HTTP 404.
5. Required physical QA: draw with Pencil on iPad, upload the original and preview,
   download and reopen in PencilKit, edit strokes again, and confirm byte/hash
   identity before editing. Confirm iPhone/desktop preview readability and conflict
   selection. This is not yet performed; no user iPad is available today.

Before any assets exist, rollback can restore the prior deployed web artifact and
roll back uncommitted migration SQL. After assets exist, disable only the API flag,
retain the schema, private credential and cleanup-aware worker, and preserve
original local drawings and immutable cloud records. Do not roll back to code
without purge/cleanup support, drop tables, delete the store, or revert migration
0014 on production data. Resume source fixes through a reviewed forward migration.

## Reproducible local evidence

- `pnpm --filter web exec tsx --test tests/private-ink.test.ts` uses actual migrated
  isolated PGlite and synthetic object bytes in memory. No private fixture leaves
  the machine. SDK adapter tests inject provider responses, checking private
  access/cache/error semantics. They do **not** prove a live store configuration.
- `python3 packages/db/scripts/verify-sync-postgres.py` starts/stops disposable
  local PostgreSQL on a private Unix socket, verifies rollback/reapplication and
  concurrent cross-workspace library/version reservations. It never reads a live
  DATABASE_URL or connects to an existing database.
- Full web/DB tests, types, build, lint and configured CI remain source checks.

Human review: verify the staged private-store and physical steps above after their
separate approvals. This issue remains incomplete until its required QA and merge
boundary are satisfied; a source PR alone is not a release.
