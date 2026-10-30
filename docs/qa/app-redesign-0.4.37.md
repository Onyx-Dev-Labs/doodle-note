# Desktop redesign 0.4.37 — release preparation

This change integrates the approved cream/sage app concept with the real desktop UI. The website redesign was separately merged in PR253 at d0c827ef197e0dda2ac15b15d5be7601e369dc3e.

## Scope

- Restyled overview and sidebar, real recent notes with folder metadata, handwritten heading, and a yellow next-step sticky wired to the existing global Ask action.
- Preserved calendar paging/join/start, note and meeting creation, audio/text imports, search, progressive history, folder/trash operations, chat history/streaming/errors, editor mount continuity, and light/dark/system preferences.
- Added bundled Bricolage, Caveat, and Geist fonts with their SIL Open Font Licenses packaged in Resources/licenses/fonts. No remote font requests.
- No sample identity, sample task data, new task persistence, download-gate changes, schema changes, or Neon/n8n changes.

## Source validation

Desktop node/renderer typechecks, lint, and production build passed. Desktop tests: 558 passed, zero failed, eight existing skips (566 total). After review corrections, typecheck/lint passed again. Independent JSX event-handler comparison found no removed/changed existing handlers; only the sidebar New note and sticky Ask actions were added. Fixed a misleading privacy sentence and truncation of long folder metadata.

Native development QA uses /tmp/doodlenote-redesign-0437-qa, an isolated profile containing generated QA notes only. Verified light/dark appearance, real notes/folder/trash lists, full-text search, editor navigation, and creating/saving a real note with the sidebar action. User library and credentials were not used.

## Release status

Version reserved: 0.4.37. Source validation and native dev QA are not a signed release. Require current-head CI, signed/notarized Mac candidate and receipt, exact-artifact verification, artifact GUI checks, immutable payload verification, and feed activation evidence before marking this released. Preserve the existing Windows beta channel and stable Windows feed.
