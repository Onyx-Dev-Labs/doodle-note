# DoodleNote v0.4.15 release candidate

## Included

- [x] Preserve TipTap to-do checkboxes when reopening notes ([ONY-213](https://linear.app/onyxdevlabs/issue/ONY-213/preserve-to-do-checkboxes-when-reopening-notes))
- [x] Bump the desktop version from 0.4.14 to 0.4.15
- [x] Add the v0.4.15 changelog entry

## Verification

- [x] Frozen-lockfile dependency install
- [x] Desktop typecheck
- [x] Desktop unit tests (including markdown hydrate regression)
- [ ] Packaged application reports version 0.4.15
- [ ] Signed and notarized arm64 package with the Swift transcription engine
- [ ] Updater ZIP and website DMG produced
- [ ] Updater manifest references only version-matched v0.4.15 artifacts
- [ ] Existing 0.4.14 client can detect the 0.4.15 update

## Release gates

- [ ] User authorized Mac packaging / updater publication
- [ ] Mac release workflow (or local `pnpm --filter desktop release`) completed on the fix branch or `main`
- [ ] Public update feed reports 0.4.15
- [ ] Human QA: note to-dos survive leave/reopen

## How to package from GitHub Actions

1. Open [Mac release](https://github.com/Onyx-Dev-Labs/doodle-note/actions/workflows/mac-release.yml)
2. **Run workflow** → branch `cursor/ony-213-preserve-note-todo-checkboxes-cbf2` (or `main` after merge)
3. After success: Check for Updates in a 0.4.14 install, or download the workflow DMG/ZIP artifacts

## Package

- Updater artifact: `DoodleNote-0.4.15-arm64-mac.zip` (pending packaging)
- Website installer: `DoodleNote-0.4.15-arm64.dmg` (pending packaging)
