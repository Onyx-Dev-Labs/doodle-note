# Receipt-bound Mac publication

This is tooling for a separately authorized publication. Implementation/testing
does not publish 0.4.35 or qualify an installed updater. Keep the retained signed
candidate unchanged. The publisher's source SHA may differ from the candidate's
SHA; `--source-sha` must name the reviewed **candidate** recorded in its receipt.

## Local preflight

Use Node 22+ (file-backed `Blob` support), Ruby (the existing manifest validator),
and the frozen workspace dependencies (`@vercel/blob` is locked to 2.8.0).
Retain the ZIP, DMG, `latest-mac.yml`, and `release-receipt.txt` together in a
directory. Obtain that receipt from the trusted signing run/artifact; it is a
plaintext attestation, not an independent signature or a replacement for QA.

```sh
node apps/desktop/scripts/publish-release.mjs --mac \
  --release-dir /path/to/retained/payload \
  --source-sha 89e28173363fa1263156096d42df8a9baeac7bea --dry-run
```

Dry run performs local validation only, including all receipt hashes and the
manifest's exact version, filenames, sizes, ZIP path, and SHA-512 hashes. It does
not load the Blob SDK, read tokens or `.env` files, contact a network, or stage a
web manifest. It uses temporary copies (copy-on-write where available), cleans
them up, and does not edit the candidate. Allow disk space for both payloads.
The version is taken from `apps/desktop/package.json` and must match the receipt.

Only `DoodleNote-<version>-arm64-mac.zip` and
`DoodleNote-<version>-arm64.dmg` are payloads. Extra directory entries are ignored;
missing exact names, payload symlinks, wrong source/team/version, duplicate
receipt entries, and mismatching bytes fail before network access.

## Upload and activation

For authorized live execution, supply `BLOB_READ_WRITE_TOKEN` through the process
environment using the maintainer's approved credential mechanism. Mac publication
no longer searches `.env.local`. Do not paste the token into command arguments,
logs, or review evidence. The destination is the existing store used by the web
proxy; a returned object from another store/path is rejected.

Run the same command **without `--dry-run`** to upload and verify payloads only.
It does not publish either manifest surface. All immutable puts use
`addRandomSuffix: false` and `allowOverwrite: false`. Existing objects and lost
upload acknowledgements are resolved by exact hash/size checks. Differing bytes
at an occupied name stop publication; they must never be overwritten or deleted
to make a rerun succeed. Resolve candidate/version ownership with the release
owner, normally by creating a new version and restarting qualification.

Each upload attempt opens a fresh file-backed `Blob` from the validated snapshot.
Unlike the old consumed `ReadStream`, this is replayable inside SDK retries too.
Outer attempts are capped at three, with bounded per-operation deadlines. Public
verification streams the full bytes from both the raw Blob URL and the installed
client route, `https://www.doodlenote.ai/updates/<exact filename>`, without auth,
redirects, or range requests. A missing response, challenge page, truncated
download, wrong digest, or wrong byte count blocks activation. It is safe to rerun
the same receipt after a transient failure; identical artifacts are reused.

Only after publication authorization and all other release gates, activate:

```sh
node apps/desktop/scripts/publish-release.mjs --mac \
  --release-dir /path/to/retained/payload \
  --source-sha 89e28173363fa1263156096d42df8a9baeac7bea \
  --activate --rollback-dir /path/to/release-evidence
```

This revalidates/reuses the exact payloads and public bytes, saves the previous
Blob and local static manifests plus activation metadata in a unique rollback
directory, and only then writes `updates/latest-mac.yml`. An existing feed
requires its observed ETag (`ifMatch`); an absent feed uses create-only semantics.
Even an observed identical feed requires a conditional write. The feed gets a
60-second cache TTL. After its read-back and anonymous public hash check pass,
the same candidate manifest is atomically staged into
`apps/web/public/updates/latest-mac.yml` in this checkout. A concurrent local edit
is refused. Review/commit/deploy that static manifest separately; the publisher
does not commit or deploy it.

Both feed surfaces can activate clients. They are **not a distributed atomic
transaction**. Serialize publication/deployment with other maintainers. The
web domain may continue serving its older static manifest until deployment.
After deploying, verify the web manifest bytes, `/download/mac` target and DMG,
then perform real prior-version updater/relaunch and library-preservation QA.
Upload/GET tests are not updater acceptance. Use an isolated supported Mac/VM;
a different Electron user-data directory alone does not isolate ShipIt/updater
caches or preserve launch arguments through updater relaunch.

## Failure and rollback

- Before the manifest put, payload errors leave both manifests unchanged.
  Successfully uploaded immutable files can remain for a safe retry.
- Once a manifest put is attempted, a timeout, lost acknowledgement, ETag
  conflict, stale public read, or local staging failure exits nonzero with the
  rollback directory. **Blob may already be active.** Do not infer rollback from
  an error or blindly retry using a newly observed feed as authority.
- Keep the earliest rollback directory as well as records from retries. It
  contains `blob-latest-mac.yml` / `web-latest-mac.yml` when those existed,
  `candidate-latest-mac.yml`, and `activation.json` (previous ETag, absence flags,
  source SHA, candidate digest and destinations). The local static backup is
  not proof of the currently deployed static bytes; retain the prior deployment
  commit separately.
- Inspect the current Blob feed and current ETag. With explicit rollback
  authorization, restore the saved prior Blob bytes using an ETag-conditional
  put (`allowOverwrite: true`, `ifMatch: <current ETag>`, 60-second TTL), or
  conditionally remove the newly created feed if the saved state was absent.
  Never use the old pre-activation ETag to overwrite an intervening release.
  Restore/redeploy the reviewed prior static manifest independently. Verify both
  public feeds after propagation. No automatic rollback races another publisher.
- Public CDN propagation can lag. SDK 2.8.0 applies `useCache: false` only to
  private reads; public reads can still be stale. Conditional writes reject stale
  ETags. A stale post-write public digest fails closed before local staging. Allow
  CDN propagation and inspect both surfaces before a deliberate retry.
- Rollback stops future update discovery; it cannot undo already installed
  updates. Those clients may require a qualified higher-version corrective build.

## CLI migration and Windows boundary

- Old no-flag / combined `--mac --win` publication is retired. Select a platform
  explicitly; Windows runs separately.
- Old `--mac` now requires `--source-sha` and a verification receipt, and defaults
  to payload-only upload/verification. Add `--activate --rollback-dir DIR` for
  intentional feed activation and web staging.
- Old `--dmg-only` remains a backfill with no ZIP upload or manifest mutation,
  but requires the complete receipt-bound candidate (including ZIP/manifest for
  validation). It cannot be combined with `--activate`.
- Legacy `pnpm --filter desktop release` rebuilds, then calls `--mac` without the
  new required source SHA. It is no longer a supported one-step release command.
  Do not use it to promote an existing candidate. Local builds must finish
  notarization/stapling and `verify-mac-release.sh` to create their receipt, then
  use the explicit commands above. The candidate workflow already creates it.
- Explicit `--win`, `release:win`, and `publish:win-beta` retain their existing
  behavior. Windows' legacy overwrite/selection/retry behavior is **not hardened
  by this change**. No Windows manifest, installer, version, workflow, or beta
  publisher is changed.

## Validation and SDK sources

`node --test apps/desktop/scripts/publish-mac-release.test.mjs` runs synthetic
file/transport tests plus a locked-SDK loopback HTTP retry/header test. The same
suite runs in normal desktop CI via `src/main/publish-mac-release.test.ts`.
No production token, service, candidate execution, native engine or model is used.

The implementation follows the [official SDK reference](https://vercel.com/docs/vercel-blob/using-blob-sdk)
for create-only puts, conditional writes, ETags and minimum cache TTL. Retry/body
and caching behavior were checked against locked 2.8.0
[request retries](https://github.com/vercel/storage/blob/%40vercel/blob%402.8.0/packages/blob/src/api.ts),
[fetch bodies](https://github.com/vercel/storage/blob/%40vercel/blob%402.8.0/packages/blob/src/fetch.ts),
and [get implementation](https://github.com/vercel/storage/blob/%40vercel/blob%402.8.0/packages/blob/src/get.ts).
