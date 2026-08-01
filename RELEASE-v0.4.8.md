# DoodleNote v0.4.8 release candidate

## Included

- [x] Combine meeting, note, and audio-import creation under one New menu
- [x] Ask whether to save, discard, or keep editing a brand-new empty draft
- [x] Stop active capture and suppress delayed writes when an empty meeting is discarded
- [x] Generate missing titles from notes, transcript text, generated-note headings, or attachment context
- [x] Keep intentional user and calendar titles unchanged
- [x] Show the last seven calendar days on Home and reveal older items in batches of 30
- [x] Keep search, folder, and Trash results unbounded
- [x] Bump the desktop version from 0.4.7 to 0.4.8
- [x] Add the v0.4.8 changelog entry

## Verification

- [x] Draft-lifecycle regression tests
- [x] Automatic-title regression tests
- [x] Meeting-history regression tests
- [x] Full desktop and AI test suites
- [x] Desktop and AI typechecks
- [x] Changed-file lint and formatting
- [x] Production Electron build
- [x] Isolated-profile desktop smoke test
- [x] Signed and notarized arm64 package
- [ ] Live update feed reports 0.4.8
- [ ] Installed 0.4.7 application detects 0.4.8

## Release gates

- [x] Feature PR reviewed with local release audit and green CI; Greptile requested twice
- [x] User authorizes merge and versioned update
- [ ] Published artifact checksum matches the live update manifest

## Package

- Artifact: `DoodleNote-0.4.8-arm64-mac.zip`
- Size: `168029009` bytes
- SHA-256: `9c50a186311ea78650c2e415f1a9cc33929f69db099382b64236711ea5e20315`
- SHA-512: `iQ+GjUhbUgB8wXXc4NOnPvewWsY1zJTaFfi9FPrZWla/Nzh8FkbcneVSZc8OI+jVt82D8gFjEDz7mKrX0qyxkQ==`
- Apple notarization: `81a61568-29d5-4d78-98d5-0c875e6b7660` (`Accepted`)
- Developer ID: `SEAN INMAN (VTZW6K32K4)`
- Gatekeeper: `accepted` (`Notarized Developer ID`)
- Stapled ticket: validated in the archive after extraction
