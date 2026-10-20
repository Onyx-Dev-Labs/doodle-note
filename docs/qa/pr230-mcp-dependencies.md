# PR230 bundled MCP dependency maintenance

This focused maintenance follows the independent dependency triage of
`d543254cdce3919db45292d5ab08abc31fdca7e8`. That triage found **no demonstrated
exploit path** for the 22 reported alerts in the inspected macOS/MCP code. This
change removes four affected package/advisory combinations from the release graph;
it is preventive maintenance, not a claim that the stdio server was exploited or
that the final packaged app has been cleared.

## Changes and primary evidence

- Pin `@modelcontextprotocol/sdk` from 1.30.0 to **1.31.0**, the fixed 1.x release
  for [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h).
  The advisory concerns OAuth **clients**, explicitly excludes SDK servers, and
  requires additional credential handling for affected clients. DoodleNote uses
  `Server` + `StdioServerTransport`; it has no SDK OAuth-client credentials to migrate.
- Constrain only `fast-uri@>=3.0.0 <3.1.8` to **3.1.8**. This covers
  [authority-port injection](https://github.com/advisories/GHSA-qw65-cvwx-89v3),
  [unclosed-authority-bracket confusion](https://github.com/advisories/GHSA-58mr-gqgx-xq4g),
  and [encoded-host case normalization](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj).
  These require security-sensitive URI use absent from the inspected stdio server;
  fast-uri nevertheless ships inside its AJV dependency and is worth patching.
- npm registry manifests verified both exact releases and integrity values. SDK
  1.31.0 retains `engines.node: >=18` and the same declared dependencies as 1.30.0.
  fast-uri remains on 3.x. The lock changes only those two package resolutions,
  SDK importer/specifier, AJV's fast-uri edge, and the bounded override. Unrelated
  ESLint peer-key churn from regeneration was removed before the frozen install.
  No dependency moved between production/dev scope; no application version,
  transport, tool, source-scope, budget, recipe, or persistence code changed.

## Rebuilt CLI inventory

`packages/doodle-note-mcp/dist/cli.js`: **605,794 bytes**, SHA-256
`df5a670db4131fe36a69e0612441a056f05c03ec09907379ebbd6a75ee20176a`.
Lock SHA-256: `3fad3fd4f1553f9033f80558fea1530069e9e2a6b42a36ec6779da03dcf55c7c`.

An in-memory esbuild 0.25.12 reproduction using the production build arguments was
byte-identical. Its metafile has 230 inputs; 113 modules contribute emitted bytes.
Versions below come from each contributing input's owning package manifest, not
just the direct dependency list. Byte attribution excludes esbuild wrappers.

| Contributing package | Version | Modules | Attributed bytes |
| --- | --- | ---: | ---: |
| @modelcontextprotocol/sdk | 1.31.0 | 11 | 119707 |
| fast-uri | 3.1.8 | 3 | 42075 |
| ajv | 8.20.0 | 63 | 213790 |
| ajv-formats | 3.0.1 | 3 | 17019 |
| fast-deep-equal | 3.1.3 | 1 | 1350 |
| json-schema-traverse | 1.0.0 | 1 | 2879 |
| zod | 4.4.3 | 19 | 158472 |
| zod-to-json-schema | 3.25.2 | 2 | 175 |
| @repo/agent-contract | 0.1.0 | 2 | 4632 |
| @repo/meetings-store | 0.1.0 | 3 | 23698 |
| doodle-note-mcp | 0.2.0 | 5 | 10302 |

The SDK inputs are `dist/esm/{server/{index,stdio,zod-compat,zod-json-schema-compat},
shared/{protocol,stdio},experimental/tasks/{helpers,interfaces,server},types,
validation/ajv-provider}.js`. fast-uri contributes `index.js`, `lib/schemes.js`, and
`lib/utils.js`. SDK client/OAuth-client, SSE and Streamable HTTP transport modules
do not contribute to this bundle. Neither do Express, proxy-addr, Hono, ip-address,
sprintf-js, http-cache-semantics, braces or brace-expansion. External imports are
only `node:process`, `node:fs`, `node:os`, `node:path`, and `node:crypto`.

To reproduce the build/metafile from the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter doodle-note-mcp build
pnpm --filter doodle-note-mcp exec esbuild src/cli.ts --bundle --platform=node \
  --format=esm --outfile=dist/cli.js --banner:js='#!/usr/bin/env node' \
  --metafile=/tmp/doodlenote-mcp-metafile.json
shasum -a 256 packages/doodle-note-mcp/dist/cli.js
pnpm audit --json > /tmp/doodlenote-full-audit.json
```

Inspect `outputs["dist/cli.js"].inputs` entries with `bytesInOutput > 0` and their
nearest named package manifests. All parsed inputs are not necessarily emitted.
Local detailed evidence is retained in `/tmp/doodlenote-pr230-dependency-fix/`:
`bundle-inventory.cjs`, `mcp-metafile.json`, `mcp-emitted-modules.json`,
`mcp-bundle-inventory.json`, registry manifests, audit JSON, and validation logs.

## Remaining audit classifications

Full `pnpm audit --json` completed with exit **1**: **18 findings**, comprising
**1 critical, 8 high, 9 moderate**, down from 22 (1/11/10). No SDK/fast-uri advisory
remains. This is **not a clean full audit**. A production-only audit excludes
devDependency roots even when their code has already been bundled into a shipped
asset; its earlier zero result was insufficient release evidence.

- **Six unused SDK HTTP-dependency findings:** proxy-addr 2.0.7
  ([trust-subnet parsing](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), critical);
  Hono 4.13.5 ([JSX rendering](https://github.com/advisories/GHSA-hxh3-vqpv-xpqv));
  ip-address 10.5.0 ([family comparison](https://github.com/advisories/GHSA-j6r3-76f7-8jcv),
  [diagnostics](https://github.com/advisories/GHSA-h3mg-xc3c-68pw),
  [classification](https://github.com/advisories/GHSA-rpw4-54j3-4h4q),
  [NAT64 classification](https://github.com/advisories/GHSA-2vr4-cq9g-pvrc)).
  These packages remain locked but have zero contributing modules in the rebuilt
  MCP. The prior triage found no corresponding current application call path.
- **Nine packaging/lint findings:** brace-expansion 1.1.18, 2.1.4 and 5.0.9 each
  remain affected by [quadratic expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
  [nested recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7), and
  [comma expansion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p).
  These are tooling paths, not meeting/tool-argument paths; hostile build inputs
  can still matter. Existing overrides require a separate targeted update.
- **Three tooling findings without a patched version in the checked advisories:**
  sprintf-js 1.1.3 ([format precision](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)),
  http-cache-semantics 4.2.0 ([shared caching](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)),
  and braces 3.0.3 ([glob recursion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)).
  Keep untrusted format/glob configuration and shared authenticated caches out of
  these build paths; track upstream fixes separately. No safe version is invented.

These classifications retain the independent triage's no-demonstrated-exploit
distinction. They do not dismiss alerts or prove absence from a final installer.

## Validation and release handoff

Frozen install; MCP **12/12** tests and typecheck; **36/36** relevant desktop
integration tests; desktop main/renderer typechecks; MCP/desktop production builds;
repository lint (desktop executed, unchanged web cache reused);
and actual **Node 18.20.8** built-CLI stdio smoke passed. The stdio smoke covers source
tools, corrected participant attribution, stale anchors, revocation, and unchanged
original bytes. The emitted worker smoke also passed under **Electron 44.0.0 / Node
24.18.1 / SQLite 3.53.1**, in Node mode. Prior full integration tests/reviews remain
evidence for unchanged feature code, not fresh native QA.

The final signed `.app` remains a parent-owned gate: compare
`Contents/Resources/mcp/cli.js` to the hash above and inventory `app.asar`,
`app.asar.unpacked`, and extra resources for unexpected package copies. Reopen
reachability if the packaged graph differs. The signing run **39082678466** targets
old `d543254`; it cannot certify this dependency update. It was not canceled or
changed. Parent must package/sign the final head and complete native QA. No signing,
workflow dispatch, publication, main merge, or application version bump is part of
this maintenance.
