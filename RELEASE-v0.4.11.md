# DoodleNote v0.4.11 release candidate

## Included

- [x] Replace the pre-rounded transparent Mac icon with an opaque edge-to-edge sage master
- [x] Use a new macOS bundle icon filename so existing clients cannot retain cached v0.4.10 artwork
- [x] Synchronize the corrected opaque mascot across desktop, web, and iOS in-app surfaces
- [x] Add a drag-to-Applications DMG for website downloads while retaining the ZIP updater
- [x] Bump the desktop version from 0.4.10 to 0.4.11
- [x] Add the v0.4.11 changelog entry
- [x] Stage the v0.4.11 updater manifest for the release deployment

## Verification

- [x] Brand-asset regression tests
- [x] Desktop test suite (114 passing, 0 skipped)
- [x] Desktop typecheck
- [x] Web test suite (18 passing) and typecheck
- [x] Production Electron and web builds
- [x] Packaged Info.plist references the cache-busting icon resource
- [x] Packaged 32, 64, and 128 px ICNS renditions are opaque RGB with no dark gutters
- [x] Signed and notarized arm64 package with the Swift transcription engine
- [x] Mounted DMG contains `DoodleNote.app` and the `/Applications` shortcut

## Release gates

- [ ] Release PR reviewed with green CI and Greptile feedback addressed
- [ ] User authorizes merge and publication
- [ ] Public update feed reports 0.4.11
- [ ] Public artifact checksum matches the update manifest
- [ ] Installed 0.4.10 client detects and installs 0.4.11
- [ ] Installed application displays the corrected Dock/Finder icon
- [ ] Website Mac download serves the v0.4.11 DMG

## Package

- Updater artifact: `DoodleNote-0.4.11-arm64-mac.zip`
- Updater size: `170287455` bytes
- Updater SHA-256: `4725c39373461e1e5aad0478941b5c28681ee4fa5d64d04f1c5662cde2411180`
- Website installer: `DoodleNote-0.4.11-arm64.dmg`
- Website installer size: `172180064` bytes
- Website installer SHA-256: `c68bdeaac3e7e2413ed87f88f6fee297e20189844ece9959c2f791e7e3d7cdea`
- Developer ID: `SEAN INMAN (VTZW6K32K4)`
- Gatekeeper: `accepted` (`Notarized Developer ID`)
- Stapled notarization ticket: validated
- Packaged icon: `CFBundleIconFile = doodlenote-opaque-v0411.icns`
- Packaged engine: arm64 Mach-O executable present
