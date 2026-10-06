# Mac 0.4.33 candidate

Prepared for DEV-417 / PR #205. This document describes an unpublished candidate,
not production acceptance. Source review, explicit merge/publication approval,
updater visibility and installed-app acceptance remain separate gates.

## Scope

- Bound local note generation, expose phase/activity, allow cancellation and safe
  retry, and reject incomplete or stale results without replacing existing notes.
- Keep the tested Electron 44.0.0 and node-llama-cpp 3.20.0 runtime versions.
- Patch the existing production audit findings with narrow overrides:
  node-llama-cpp > simple-git 4.0.2 (argv-parser 2.0.1), prosemirror-view 1.42.3,
  source-map-js 1.2.2, and sharp 0.35.5 (libvips 1.3.4).
- No storage migration, model/provider default change or Windows publication.

## Dependency compatibility

The simple-git override follows the same approach as DEV-374 / PR #201, without
bringing in that candidate's Windows or broader dependency changes. Version 4
removes legacy/default exports. All node-llama-cpp 3.20.0 call sites use the
supported named `simpleGit` export. A local synthetic repository smoke passed
the actual dependency's import, shallow branch/recursive clone options, bundle
clone, remote removal, log lookup and patch application. No unsafe Git options
or audit exclusions were enabled.

Sources: [simple-git release notes](https://github.com/steveukx/git-js/releases),
[ProseMirror advisory](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w),
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
[sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

Frozen installation and production audit pass with no known vulnerabilities.
Desktop tests pass (356 passed, 8 platform skips), AI tests pass (33), web tests
pass (128), desktop/web typechecks and lint pass. See [DEV-417 QA](dev-417.md)
for the generation behavior checks. Exact-commit CI and artifact receipts must
be recorded with the final candidate; these local results alone are not a release.

Sean accepted the previously failing real meeting's generated result in an
isolated development runtime at 7a7d5f5. The private meeting/result remain local;
neither is a repository fixture. This is not installed-release acceptance.

## Release and recovery

Candidate artifact source: `d06bd327ccd67ac6b4b279c5ecfac02a0ee5357a`.
Required CI, CodeQL, Windows packaging/native smoke and the web preview pass at
that source. The Swift engine and pinned Whisper CLI built locally. The Mac app
and DMG are signed with Developer ID SEAN INMAN (VTZW6K32K4); their Apple
notarizations were accepted (`70611c12-1829-4bbd-8543-7b3845138463` and
`46802b60-c616-48d2-8cbb-1721055cd0ad`). Staples, signatures and Gatekeeper pass.
The extracted ZIP payload matches all 970 built-app entries. A packaged Metal
model smoke passed actual cancellation, cleanup before retry and successful
generation, with downloads disabled and no user profile access.

Final distributables after DMG stapling:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| DoodleNote-0.4.33-arm64-mac.zip | 186326644 | 9ef996e47ca62485e657aee77be76e40fae958e7af4aaf4e5f868633d6e98826 |
| DoodleNote-0.4.33-arm64.dmg | 188249984 | 7a870f18793d7be4e9a9b9a925cbaec2d74fe6db4d921513bc94297a82b007ba |

The final PR additionally stages these artifacts' manifest and this evidence;
those metadata changes do not change the packaged application. Upload and verify
the qualified artifacts before merging the manifest, which activates the website
download and Mac updater. Nothing has been uploaded or installed by preparation.

Build the Swift engine and package the Mac app separately from publishing.
Use the existing Developer ID and OAuth configuration; validate signatures,
notarization, staples, Gatekeeper and archive payloads before distribution.
Record the exact source and final ZIP/DMG hashes outside the product bundle.

After source review and explicit approval, upload only the 0.4.33 Mac ZIP/DMG
and publish the matching Mac manifest, release entry and changelog. The current
Mac publisher has a known consumed-stream retry failure from 0.4.32; use a
qualified replayable upload path before publication. Do not run the release
script or the Mac release workflow merely to build a candidate.

Verify public files, then test the real 0.4.32 updater/relaunch with a private
backup and library preservation checks. Verify bounded generation/cancel/retry
and the approved long meeting on the installed build. Independent physical
Windows cancellation remains outside this Mac release's acceptance.

Retain 0.4.32 artifacts and the prior feed. Before clients update, the previous
feed can be restored. Updated clients need a compatible, signed higher-version
corrective build, with all existing and newly created library data preserved.
