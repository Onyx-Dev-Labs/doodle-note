# Dependabot remediation verification — 2026-10-29

Baseline: `99cf748661ca588d8250aebcbb5b9c1edb2a799b` on `main`.
The authenticated [Dependabot alert list](https://github.com/Onyx-Dev-Labs/doodle-note/security/dependabot)
contained 36 open alerts across 10 package names: 1 critical, 11 high,
21 medium and 3 low. Those represent 27 distinct advisories. The baseline
full pnpm audit reported 33 findings because three SDK advisories also appear
as separate package-manifest alerts on GitHub.

## Changes and alert coverage

- SDK `1.31.0` → `1.32.0`: #102–#105, #122–#124.
- proxy-addr `2.0.7` → `2.0.8`: #90 (critical).
- body-parser `2.3.0` → `2.4.0`: #131.
- qs `6.16.0` → `6.16.1`: #147.
- Hono `4.13.5` → `4.13.11`: #87, #101.
- @hono/node-server `2.1.1` → `2.1.3`: #156.
- ip-address `10.5.0` → `10.7.4`: #72, #73, #84, #85, #128.
- fast-uri `3.1.8` → `3.1.9`: #133–#136.
- brace-expansion `1.1.18`/`2.1.4`/`5.0.9` → `1.1.21`/`2.1.7`/`5.0.12`: #75–#83.
- Vite `7.3.6` → `7.3.7`, with the direct declaration raised to `^7.3.7`:
  #106–#108, #110–#111.

Bounded overrides remain in `pnpm-workspace.yaml`, the repository's single
override authority. Other floors, native platform configuration, and the
notarize patch are unchanged. CI and current contributor/release instructions
now audit development dependencies too: the SDK is a devDependency but its
code is bundled into the shipped CLI.

Every version in the lockfile was compared against the vulnerable range of
each of the 36 baseline alerts using semver (normalizing GitHub's comma-separated
range syntax and rejecting invalid ranges). All 36 are covered. This establishes
source dependency remediation; GitHub alert closure still requires merging to
the default branch and rescanning.

## Passing verification

- pnpm **10.33.2** frozen-lockfile installation.
- Full `pnpm audit --audit-level=low`: **zero known vulnerabilities**;
  `pnpm audit --json` also exited 0. Baseline: 33 findings.
- MCP typecheck, **12 tests**, and production bundle build.
- Desktop main/renderer typechecks; **558 passed, 8 skipped, 0 failed**;
  production main, preload, worker and renderer builds.
- Meetings-store typecheck and **38 tests**; AI **73 tests**; database **33 tests**.
- Web typecheck, **144 tests**, authentication smoke and production build with
  `DOODLENOTE_SELF_HOSTED=true`.
- Repository lint: both desktop and web executed successfully.
- Mac candidate verifier: **38 Python tests**, **10 Node protocol/cleanup tests**,
  and Ruby workflow/manifest checks (**11 tests, 155 assertions**).
- Vite **7.3.7** startup with the actual electron-vite renderer configuration,
  HTTP/stylesheet responses and a WebSocket CSS hot-reload update. The temporary
  CSS edit was restored; no product source changed.

Desktop and web test suites and the Vite smoke completed under **Node 22.23.4**,
matching CI's Node 22 major. The initial concurrent run on host Node 24.22.0 had
one desktop subprocess-start timeout, two Python fixture-start timing failures,
and two web subprocesses aborting inside V8's Wasm allocator
(`Check failed: end > addr`). The desktop and Python failures passed isolated
reruns, and the complete desktop/web suites passed on Node 22. No application
changes were made to hide these failures. The initial Vite smoke harness also
needed orderly WebSocket/dependency-scan teardown; its final Node 22 run exited 0.

## Built and packaged code

The rebuilt MCP CLI is **649,924 bytes**, SHA-256:

```text
79160258a7aac4ba8a679df34d6868ff7b3e96ef2afea3480a69b9ed2785be78
```

An esbuild metafile attributes emitted bytes to 113 modules. SDK **1.32.0**
contributes 11 modules; fast-uri **3.1.9** contributes three. AJV 8.20.0,
ajv-formats 3.0.1 and Zod 4.6.6 remain unchanged. Express, Hono, proxy-addr,
body-parser, qs, ip-address, brace-expansion and Vite do not contribute to this
CLI bundle. SDK HTTP/OAuth-client transports are not part of the stdio entrypoint.

The existing `mcpSmoke` from `apps/desktop/scripts/mac-candidate-runtime-smoke.cjs`
passed against the built CLI on **Node 18.20.8** and **Electron 44.10.0 /
Node 24.22.1**. It verifies initialization, tool discovery, source search,
resolution, participant correction, stale anchors, access revocation and unchanged
original bytes. The existing emitted-worker smoke also passed under Electron,
including cancellation and scope refusal. All fixtures were synthetic and isolated.

Local packaging command (after desktop and MCP builds):

```sh
pnpm --filter desktop exec electron-builder --win --x64 --dir --publish never \
  -c.win.signAndEditExecutable=false \
  -c.directories.output=/tmp/doodle-security-win-package
```

The Windows unpacked directory was generated successfully. Its extra-resource
MCP CLI is byte-identical to the verified CLI above, and its MCP manifest pins
SDK 1.32.0. Package-manifest inventory of `app.asar` found none of the ten affected
package names; the SDK/fast-uri code ships in the separate bundled CLI instead.
This is an **unsigned cross-built directory**, not an NSIS installer or a native
Windows execution/signature test. Native Windows packaging/runtime checks remain
the PR CI gate.

## Reachability and remaining release gates

The application uses SDK `Server` with `StdioServerTransport`. No HTTP transport,
bearer middleware, SDK OAuth client or experimental taskStore was introduced.
The SDK's [HTTP memory-limit](https://github.com/advisories/GHSA-46jr-4wx8-v453)
and [audience-validation](https://github.com/advisories/GHSA-rvq5-wwqv-78pq)
fixes require opt-in settings for affected HTTP applications; those settings do
not apply to this stdio entrypoint. A clean audit does not prove exploitability
before the patch or establish the safety of future HTTP integration.

A full macOS package was not built: this checkout lacks the Swift/Whisper build
artifacts and the host has no CMake on PATH. A production desktop GUI launch was
not exercised; renderer HMR and CLI/worker execution do not establish that check.
Production GUI launch, native capture, signed/notarized Mac artifacts, native
Windows installer execution, publication and installed-user
verification remained release gates at verification commit `098289c`.
That commit did not change the release version, updater feed, signing setup,
production data, or publication state.
Already-installed apps require a rebuilt release to receive the bundled fixes.

## Production rollout preparation — 2026-10-30

The user authorized merging and deploying the web and Mac fixes, with Windows
prepared but not published pending its Microsoft signing certificate. The branch
now incorporates main `14c99c9` (download email gate), and desktop version **0.4.36**
identifies the fresh security release candidate. Windows packaging also uses this
version; its official feed remains unchanged. Public Mac feeds and changelog stay
on the released version until receipt-bound candidate qualification/publication.

The full integration CI and signed Mac candidate workflow must run against the
new source commit. Earlier passing results above remain evidence for their
original source, not proof of the new candidate. Production activation, signed
artifact qualification, and installed-user QA are tracked separately.
