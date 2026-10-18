# GitHub macOS candidate runner

Target: `Onyx-Dev-Labs/doodle-note`, Apple Silicon, existing Developer ID team
`VTZW6K32K4`. Windows publication still requires native Windows QA.

## Configure credentials

Use a trusted terminal with Python 3 and an authenticated `gh` account that can
manage this repository's Actions secrets. Export **Developer ID Application:
SEAN INMAN (VTZW6K32K4)** together with its private key from the signing Mac's
Keychain as a password-protected `.p12`. A `.cer` alone cannot sign releases.
If the private key is unavailable, the Apple Developer team owner must arrange
a replacement signing identity; this helper cannot recover it.

Run from the repository:

```sh
python3 apps/desktop/scripts/configure-mac-release-secrets.py
gh secret list --repo Onyx-Dev-Labs/doodle-note
```

The helper asks for the local export path, then uses hidden terminal prompts
for credentials. It sends values to `gh secret set` through stdin, never command
arguments, and creates no credential file. Do not paste values into chat,
workflow logs, shell commands, or this repository. Existing secret names are
preserved; rerunning resumes missing entries, rather than rotating credentials.

Required repository secrets:

| Name | Purpose |
| --- | --- |
| `MAC_CSC_LINK` | Base64 `.p12` including private key; helper encodes the export |
| `MAC_CSC_KEY_PASSWORD` | Password protecting that export |
| `APPLE_ID` | Apple ID authorized for the signing team |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password for notarization |
| `APPLE_TEAM_ID` | `VTZW6K32K4`; helper supplies this public identifier |
| `DOODLENOTE_GOOGLE_CLIENT_SECRET` | Existing Desktop OAuth client credential |

The helper refuses terminal echo fallback and oversized exports. It validates
presence, not certificate validity, expiration, password correctness, or Apple
authorization. Existing wrong values must be rotated explicitly in
[repository Actions secrets](https://github.com/Onyx-Dev-Labs/doodle-note/settings/secrets/actions).
Keep the signing export in approved secure storage after setup. It must not be
committed or uploaded as a workflow artifact.

## Build and qualify a candidate

1. Review the candidate commit and version. Select **Mac release candidate** in
   Actions and dispatch that branch/ref. Record the run URL and exact commit.
2. Require the credential check, native engine builds, packaging, notarization,
   and verification steps to pass. A credential name existing is not success.
3. Download `doodlenote-mac-<commit>` from that run. Preserve the ZIP, DMG,
   `latest-mac.yml`, and `release-receipt.txt`; retention is 14 days. The receipt
   records source, version, signing team, and SHA-256 hashes.
4. Complete clean install, update, capture, transcription, generation, and
   issue-specific native QA using those artifacts. Follow all remaining
   [release gates](../RELEASING.md#macos-checklist).
5. Publish the qualified bytes separately. This workflow does not upload to
   Blob, replace the public updater, or create a GitHub Release. Never rebuild
   implicitly when promoting a tested candidate.

The DMG is signed explicitly because electron-builder's DMG signing default is
false. Stapling changes the DMG bytes; the helper updates only that entry and
requires the ZIP hashes to remain correct. Verification mounts the DMG read-only
and compares its app and the extracted ZIP app to the signed source bundle.

References: [electron-builder signing](https://www.electron.build/v26/docs/features/code-signing/),
[DMG configuration](https://www.electron.build/v26/docs/dmg/),
[GitHub secret stdin/encryption](https://cli.github.com/manual/gh_secret_set).
