# DoodleNote v0.4.10 release candidate

## Included

- [x] Include the compact 800 × 560 desktop window minimum merged in PR #55
- [x] Invalidate the stale macOS application-icon cache on update
- [x] Deliver one native meeting notification while retaining the in-app action banner
- [x] Bump the desktop version from 0.4.9 to 0.4.10
- [x] Add the v0.4.10 changelog entry

## Verification

- [x] Prompt-delivery regression tests
- [x] Desktop test suite
- [x] Desktop typecheck
- [x] Production Electron build
- [x] Packaged Info.plist references the versioned icon resource
- [x] Signed and notarized arm64 package with the Swift transcription engine
- [x] Compact-window visual smoke test from the unchanged PR #55 implementation
- [ ] Native-notification smoke test

## Release gates

- [ ] Release PR reviewed with green CI and Greptile feedback addressed
- [ ] User authorizes merge and publication
- [ ] Public update feed reports 0.4.10
- [ ] Public artifact checksum matches the update manifest
- [ ] Installed 0.4.9 client detects and installs 0.4.10
- [ ] Installed application displays the corrected icon and allows an 800 × 560 window

## Notes

- The v0.4.9 installed bundle already contains the corrected full-bleed icon from PR #53;
  macOS retained the previous artwork in its application-icon cache.
- The public updater feed still reports v0.4.9, so the window-resize change in PR #55
  has not yet reached installed clients.

## Package

- Artifact: `DoodleNote-0.4.10-arm64-mac.zip`
- Size: `170890800` bytes
- SHA-256: `ae4ef04cc9db8f18d17ec3e6a10344ab1d48a02139ae1ecfedea5aa2c03468a5`
- SHA-512: `kQmOK2+HmUbyiJUIEtS67AWQ3h0c0j3+xhCFQ4EvFNM4tDhVn7Om9wz7bAIsrglhkCBMyDlIp1JawBpmDOlPTw==`
- Developer ID: `SEAN INMAN (VTZW6K32K4)`
- Gatekeeper: `accepted` (`Notarized Developer ID`)
- Stapled notarization ticket: validated
- Packaged icon: `CFBundleIconFile = doodlenote-full-bleed.icns`
- Packaged engine: arm64 Mach-O executable present
