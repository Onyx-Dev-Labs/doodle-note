# Complete-library search

ONY-251 uses a local lexical index for the explicitly selected library. Every query reconciles all saved, readable, authorized active notes. There is no recent-note window. Revisions that have not changed reuse their index documents; edits, summary selection, imports, sync changes and Trash/restore update the next query snapshot. The actor performs indexing and matching outside the main actor.

Search covers note titles, typed paragraphs, transcript passages and the selected summary version. Audio, ink, voice profiles and credentials are excluded. Query terms use case and diacritic folding and can occur in different passages of the same note. This is lexical matching, not semantic or model-generated recall.

Counts and matching note IDs are computed before limiting displayed sources. The interface starts with 100 sources and allows more. Callers needing every source pass `limit: nil`. Unreadable or unsaved sources produce an explicit incomplete state. A failed cache write does not prevent current results; malformed cache bytes or checksums rebuild from source records. Cache files are protected and excluded from backup.

Title, typed and transcript anchors retain the immutable note revision. A summary anchor uses its immutable SummaryVersion ID as both the summary content ID and revision ID. The repository resolves retained versions after later edits, and refuses sources whose note is trashed, purged or outside the authenticated scope. Account changes invalidate in-flight results and source sheets. Local-only notes remain usable without an account.

Verification includes a 500-note synthetic fixture with oldest-record recall, complete counts beyond the display limit, scope and stale-generation rejection, cache restart/corruption, selected-summary behavior, retained original sources after edits, and Trash/restore/sign-out source access. The UI fixture is DEBUG-only, requires `--ui-testing --search-fixture`, and uses a separate test directory. It contains no real recordings or account data.

Rollback can remove the rebuildable SearchCache directory without changing notes or revisions. Do not delete source directories to rebuild search. The optional new title/summary anchor cases require readers to support their explicit types; older readers must preserve unsupported payloads rather than reinterpret them.
