# DEV507 software checks at 79e506a

Production source: `79e506ace65a99352b1bdd9af35b9df7f541b260`. Node 24.22.0, pnpm 10.33.2, macOS 26.6.2 (25G83), Darwin 25.6.0 arm64. Synthetic originals and isolated temporary roots only. These results do not include DEV509's later consumer branch.

| Check | Result |
|---|---|
| meetings-store tests | 51 passed, 0 skipped |
| AI tests | 74 passed, 0 skipped |
| read-only MCP tests | 13 passed, 0 skipped |
| desktop tests | 526 passed, 8 existing native-prerequisite skips |
| all four affected package typechecks, including desktop node/web | Passed |
| desktop and MCP builds | Passed |
| root lint | Passed; web cached, desktop rerun |
| production dependency audit, low severity threshold | No known vulnerabilities found |
| actual Node 18.20.8 built MCP stdio | Passed; evidence/census/resolve/revocation and original preservation |
| built desktop source-worker protocol under Node 24.22.0 | Passed; no Electron app launched |
| frozen software retrieval evaluator | 20/20 must-find, 40/40 lexical gold selected; originals unchanged |

Commands:

```sh
pnpm -r --workspace-concurrency=1 --filter @repo/meetings-store --filter @repo/ai --filter doodle-note-mcp --filter desktop test
pnpm -r --workspace-concurrency=1 --filter @repo/meetings-store --filter @repo/ai --filter doodle-note-mcp --filter desktop typecheck
pnpm --filter desktop build
pnpm --filter doodle-note-mcp build
pnpm lint
pnpm audit --prod --audit-level=low
# Existing cached Node 18 executable, no runtime download:
"$NODE18" packages/doodle-note-mcp/scripts/source-smoke.mjs
(cd apps/desktop && node scripts/cited-source-smoke.cjs)
pnpm --filter @repo/meetings-store exec tsx scripts/evaluate-evidence.ts
```

Raw logs: `.superpowers/sdd/2026-10-18-dev507-cited-ask/final-*-79e506a.log`. Machine-readable smoke and quality outputs are adjacent. Eight desktop skips require real import/capture/Whisper prerequisites; no skipped check is counted as passed. The emitted-worker smoke checks the bundled protocol under ordinary Node, not Electron/ASAR. The isolated install lacks `electron/path.txt` and `electron/dist/Electron.app/Contents/MacOS/Electron`; no download or existing personal/QA app was used to bypass that prerequisite.

At exact 79, hosted CI checks and CodeQL passed but Windows desktop tests failed eight audio/controller assertions before packaging. The failure is retained at [Windows job 117788810493](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/39165951862/job/117788810493); the subsequent narrow path fix needs its own exact-commit evidence. Vercel success does not qualify desktop behavior. Automated `alectribble` review was already requested; no duplicate request was made.

The actual React Home/controller/store harness and 1280×900 / 480×900 light/dark screenshots are separately scoped to 35f965c in [visual checks](visual-checks.md). Independent service, audio, Home and optimization reviews are bounded in [review ledger](review-ledger.md). Native model wire/schema, independent human semantics, full request responsiveness and packaged media/lifecycle remain separate gates. Production stays off.

## Final production delta at 47fdf34

The only production change after 79 is the [audio path compatibility fix](audio-path-compatibility.md), commit `47fdf34e9d5150d3fdbb834620108c2ae0aa7e47`. Desired regression RED on 79, then 18 focused adapter/Home checks passed with zero skips. Full desktop tests: **527 passed, eight existing native-prerequisite skips, zero failed**. Desktop node/web types, touched lint, root lint and desktop build passed. Logs are `audio-path-*` and `final-*-47fdf34.log` in the same ledger. Store/AI/MCP production is unchanged from the 79 checks above. Later commits add only QA helpers, evidence and documentation, with no new inference/timing run.

The GitHub push banner reports default-branch Dependabot alerts; that is separate from the branch production-dependency audit above, which returned no known vulnerabilities. No blanket repository security-clean claim is made.

At the bounded GitHub inspection of documentation head `098f2b65aab6d9c3e6828198a1acf9609a98d5ce`, hosted checks, JavaScript/TypeScript analysis and Windows packaging were still running; they are not reported as passed. Existing reviewer request `alectribble` remained present. No polling/watch loop or duplicate review request was started.
