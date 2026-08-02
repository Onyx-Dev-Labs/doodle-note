# DoodleNote v0.4.9 release candidate

## Included

- [x] Replace the desktop icon assets with the corrected full-bleed DoodleNote artwork
- [x] Keep the macOS, Windows, and iOS app icons visually consistent
- [x] Bump the desktop version from 0.4.8 to 0.4.9
- [x] Add the v0.4.9 changelog entry

## Verification

- [x] Desktop tests and typechecks
- [x] Production Electron build
- [x] Signed and notarized arm64 package
- [x] Gatekeeper accepts the extracted application
- [x] Stapled notarization ticket validates in the extracted application
- [ ] Live update feed reports 0.4.9
- [x] Published artifact checksum matches the uploaded update manifest

## Release gates

- [x] Corrected iOS icon verified on the simulator Home Screen
- [x] Corrected desktop icon verified from the packaged source asset
- [x] User authorizes the production desktop update

## Package

- Artifact: `DoodleNote-0.4.9-arm64-mac.zip`
- Size: `166656809` bytes
- SHA-256: `03cebd36d31a62c9a3c45713a3ed36d6b287b1815aad167be450c40772ae409d`
- SHA-512: `8wm16SnCJkuK9nJFpsbl2S6arN4//wUVvfErYKkHbpIylBgFx9Oogl++abbfi11QJCBGyUOIqHiSl7SWl5CkqA==`
- Apple notarization: `e176c91f-7395-41f4-bfd3-0733654f6d1d` (`Accepted`)
- Developer ID: `SEAN INMAN (VTZW6K32K4)`
- Gatekeeper: `accepted` (`Notarized Developer ID`)
- Stapled ticket: validated in the archive after extraction
