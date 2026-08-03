# DoodleNote v0.4.10 release candidate

## Included

- [x] Include the compact 800 × 560 desktop window minimum merged in PR #55
- [ ] Invalidate the stale macOS application-icon cache on update
- [ ] Deliver one native meeting notification while retaining the in-app action banner
- [x] Bump the desktop version from 0.4.9 to 0.4.10
- [ ] Add the v0.4.10 changelog entry

## Verification

- [ ] Prompt-delivery regression tests
- [ ] Desktop test suite
- [ ] Desktop typecheck
- [ ] Production Electron build
- [ ] Packaged Info.plist references the versioned icon resource
- [ ] Signed and notarized arm64 package
- [ ] Compact-window visual smoke test
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
