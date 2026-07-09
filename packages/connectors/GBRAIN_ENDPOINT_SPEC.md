# GBrain ingestion endpoint — spec

What the GBrain service (Railway) must implement to receive finalized
DoodleNote meetings from the `gbrain` connector. The endpoint owns the Git
writeback; DoodleNote clients (Mac/iOS) never hold GitHub credentials.

## Request

`POST <endpointUrl>` — e.g. `https://<gbrain-host>/api/ingest/doodlenote`

Headers:
- `Authorization: Bearer <api key>` — a GBrain-minted, per-user, revocable key
- `Content-Type: application/json`

Body (`schema_version: 1`):

```json
{
  "schema_version": 1,
  "source": "DoodleNote",
  "doodlenote_id": "<uuid>",
  "content_hash": "<sha256 hex>",
  "files": [
    { "path": "meetings/<YYYYMMDD>-<slug>-<uuid>.md", "content": "<markdown>" },
    { "path": "meeting-summaries/<YYYYMMDD>-<slug>-<uuid>-summary.md", "content": "<markdown>" }
  ],
  "index": {
    "doodlenote_id": "<uuid>",
    "title": "Quarterly Budget: Review!",
    "date": "2026-07-08T10:00:00.000Z",
    "meeting_path": "meetings/<...>.md",
    "summary_path": "meeting-summaries/<...>-summary.md",
    "duration_min": 45
  }
}
```

- `files[].path` is relative to `brain/09-raw-sources/doodlenote/`.
- `files[].content` already includes frontmatter (`source`, `source_kind`,
  `doodlenote_id`, `title`, `created_at`, `started_at`, `ended_at`,
  `calendar_event_id`, `folder`, `content_hash`). The server appends
  `ingested_at: <commit-time ISO>` to each file's frontmatter before writing.
- Rendering is deterministic client-side: the same content always produces
  the same paths and bytes.

## Required behavior

1. **Validate** before touching Git:
   - bearer key is valid and maps to a configured user (else `401`)
   - body parses, `schema_version === 1`, paths match
     `^meetings/|^meeting-summaries/` with no `..` traversal (else `422`)
   - payload ≤ a sane cap, e.g. 10 MB (else `413`)
2. **Upsert idempotently**, keyed on `doodlenote_id`:
   - if a stored meeting with this `doodlenote_id` already has this
     `content_hash`, return `200` and change nothing (retry no-op)
   - otherwise delete any previously written files for this `doodlenote_id`
     whose paths differ (title/date changed → filename changed), write the
     new files, and regenerate the `meeting-index.md` entry from the `index`
     block (one entry per `doodlenote_id`, newest first)
3. **Commit server-side** to the 2nd-brain repo (one commit per ingestion is
   fine; batching is an internal concern), then trigger the existing GBrain
   import/embedding pipeline.
4. **Respond**: `200`/`201` on success. The connector treats `5xx` and
   network failures as retryable (exponential backoff, same payload), and
   all other `4xx` as permanent until the meeting's content changes.
5. **Log without content**: request logs should carry `doodlenote_id`,
   `content_hash`, sizes, and outcome — never note/transcript bodies.

## Suggested index entry format

```markdown
- 2026-07-08 — [Quarterly Budget: Review!](meetings/20260708-quarterly-budget-review-<uuid>.md)
  ([summary](meeting-summaries/20260708-quarterly-budget-review-<uuid>-summary.md), 45 min)
```

The index is server-owned: regenerate the whole file from stored ingestion
records rather than patching lines, so concurrent ingestions can't corrupt it.
