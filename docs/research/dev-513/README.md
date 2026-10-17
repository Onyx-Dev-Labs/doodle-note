# DEV-513: explicit screen evidence — bounded research

**Decision proposed: go for a separately approved native feasibility trial; no-go for production rollout or automatic capture.** The disposable [prototype](prototype.html) demonstrates explicit single-source selection, retained originals and unique meeting occurrences using synthetic images. It does not establish native capture feasibility, image quality, usefulness in real meetings, or production durability. Sean’s acceptance of this report is still required for Done.

[DEV-513](https://app.notion.com/p/3fcf0f846ee481ecb74eed82fd8f3f72) · [Doodle Note project](https://app.notion.com/p/3e1f0f846ee4819b8c7cf705a161b841). Research performed October 17, 2026; macOS 26.6.2 (25G83), arm64, Node 24.22.0, T3 collaborative browser reporting Chrome 154.0.0.0. No production source, schema, dependency, workflow or release changes; no production helper imports. All committed images depict only this experiment’s synthetic content.

## Question and lane

Can one deliberate capture retain inspectable image evidence and its meeting moment locally, while cancellation, denial and exclusion leave no new content? Can identical image storage be deduplicated without losing repeated observations?

Onyx `fetch self` verified Sean Inman (`3add872b-594c-81ae-9621-000211a17626`, sean@onyxdev.io). DEV-513, the full project/issue contract, Issues schema, related DEV-286 and DEV-506 were read before editing. The saved project view returned 86 rows with no remaining pagination; DEV-513 was unassigned, Backlog, authoring-only. No DEV-513 PR or competing local branch existed. Claim and In Progress readback completed at approximately **2026-10-17T23:38Z**, with claim time **23:37:50Z** (Notion Started stores minute precision).

- Branch: `t3/research-dev513-capture-prototype`.
- T3-owned exclusive worktree: `/Users/sean/.t3/worktrees/doodle-note/t3-c1494bab`.
- Fetched base: `origin/main` at `b53c078685b00d901a321192e886574ff0c17701`.
- The inherited `43f4850f0ea07dcde4da48b1b94c27996f4d735c` lane was clean with zero unique commits. `git rebase --onto origin/main 43f4850...` moved the empty branch to main, excluding DEV-512 vault docs. Git used `/Library/Developer/CommandLineTools/usr/bin/git`; no license or global toolchain changes.
- Review: configured CODEOWNER `alectribble`; product/report acceptance: Sean. Parent owns integration/release. Root `/Users/sean/doodle-note` and other lanes were not edited.

## Existing implementation and future contract

At the pinned main revision, [MediaService](https://github.com/Onyx-Dev-Labs/doodle-note/blob/b53c078685b00d901a321192e886574ff0c17701/apps/desktop/src/main/media-service.ts) saves allowed image MIME types, up to 15 MiB, as UUID-named files and returns `doodle-media://` URLs. That path contains no meeting-time/provenance or occurrence-dedup model. [MeetingView](https://github.com/Onyx-Dev-Labs/doodle-note/blob/b53c078685b00d901a321192e886574ff0c17701/apps/desktop/src/renderer/src/MeetingView.tsx#L400) inserts pasted/dropped/picked images after asynchronous `window.media.save`; errors are logged. This is a useful attachment precedent, not a screen-evidence implementation.

[Main wiring](https://github.com/Onyx-Dev-Labs/doodle-note/blob/b53c078685b00d901a321192e886574ff0c17701/apps/desktop/src/main/index.ts#L807) passes an active library-root getter and availability guard. [LibraryStorage](https://github.com/Onyx-Dev-Labs/doodle-note/blob/b53c078685b00d901a321192e886574ff0c17701/apps/desktop/src/main/library-storage.ts) includes `attachments` in verified relocation and refuses an unavailable configured root rather than creating a replacement. Source and transferred manifests must match; a recovery copy remains. Future screenshot persistence must use that same availability/relocation barrier. Deletion policy must account for retained references and recovery copies; removing a note is not proof that every original byte was erased.

[DEV-506’s contract at bd2fa54](https://github.com/Onyx-Dev-Labs/doodle-note/blob/bd2fa54ce53e1d6ccb5577aaf888699690c9f006/packages/meetings-store/README.md) is **unmerged reference material**, not imported code. It defines library/account/workspace scope, source and revision anchors, re-resolution with explicit stale/missing/unauthorized/unavailable outcomes, and a library sidecar that travels with originals. Its current source kinds do not include images. Its ongoing live-relocation and malformed-summary coverage fixes remain in its own lane. No competing library UUID, image source kind or production citation format is introduced here. The scratch counters are not citations.

Future integration should reuse the accepted DEV-506 identity and extend its contract through review. Account-independent originals must remain independent of sign-in. Scope/eligibility is **not export permission**; a capture gesture authorizes only the requested local action, not cloud sync, model input, or sharing. DEV-286’s richer mobile preservation and mixed-client QA remain separate.

## Platform facts and native limit

Apple documents system-picker callbacks for selected content, cancellation and failure; picker configuration can restrict modes and exclude windows/apps. Its screenshot API accepts a content filter and configuration and returns an image asynchronously, including filters obtained from the picker. **Proposal:** evaluate a single-window picker plus one-shot `SCScreenshotManager`, fence callbacks by selection/meeting/library generation, and discard cancelled or stale results. This is a proposed design, not code exercised here. [Apple WWDC23, picker 4:36 and screenshot API 9:46](https://developer.apple.com/videos/play/wwdc2023/10136/).

Electron documents window/screen source enumeration, thumbnails, macOS consent, and an experimental system-picker route whose use bypasses the app’s request handler. Consequently, handler validation alone cannot establish the selected surface on that route. Avoid copying the documentation’s first-screen/loopback example into this workflow; verify a one-window, audio-disabled result and fail closed if it cannot be established. [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer/).

The only OS capture-related operation performed was this read-only preflight:

```sh
python3 - <<'PY'
import ctypes
cg = ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
cg.CGPreflightScreenCaptureAccess.restype = ctypes.c_bool
print(cg.CGPreflightScreenCaptureAccess())
PY
# False
```

No permission was requested or granted, and no native screen/window enumeration or capture ran. This result describes that Python host process; it does **not** prove every picker-mediated API would fail or that a separately packaged app has the same permission. The native picker/permission path remains untested. The authorized fallback is the synthetic pipeline, not broader capture. No personal desktop, real microphone/call, credentials, settings, or models were accessed by the probe.

## Reproduce

Open `prototype.html` directly in a modern browser, or use this verified local-only launch from repository root:

```sh
python3 -m http.server 8513 --bind 127.0.0.1 --directory docs/research/dev-513
# Open http://127.0.0.1:8513/prototype.html
node --test docs/research/dev-513/probe.test.mjs
```

The server serves only the research directory. It receives no image uploads. The page embeds all styles, logic and fixtures, uses CSP `connect-src 'none'`, and has no remote-resource or media-capture calls. Open one controller tab; its two fixture windows are read-only. The local browser profile stores original PNG data and metadata together under `DEV513_PROTOTYPE_WIPE_ME_v1`; no account or production library is involved. Direct-file cold launch was not exercised in this T3 browser; browser-specific file-origin storage behavior remains a manual check.

Use **Erase this prototype’s evidence** to remove its retained moments/originals, then close its synthetic windows. This is logical removal from this scratch store, not forensic erasure from browser storage, backups or this repository’s committed synthetic evidence. Corrupt/unreadable scratch data fails closed rather than being overwritten; inspect/remove that specific key manually if testing corruption. No generic storage clear operation exists.

## Fixture matrix and observed outcomes

The committed [PNG](evidence/original-synthetic-slide.png) is the **generated** original from the canvas serializer, not a native-window screenshot. It is 960×540, 46,211 bytes, SHA-256 `ac4c8c0df9180f5b4a6f285bc78834d250c0ab992f5354094e86edfed9bd1e6f`. [Retained manifest](evidence/retained-manifest.json) records two observations at synthetic meeting offsets 42,000 and 60,000 ms and their actual UTC action times. Hash equality was independently checked with `shasum -a 256`. Font/platform rendering can change bytes on another machine; dedup is within a run, not an assertion of cross-platform rendering equivalence.

| Case | Observed evidence | Boundary |
| --- | --- | --- |
| Explicit selection/action | Capture disabled before selection; keyboard Choose → confirm → Capture saves the named source, synthetic meeting time, UTC action time and original | Simulated picker and manually set meeting clock; no native frame-time accuracy claim |
| Cancel/denied | Escape returns focus to chooser; denial resets selection and leaves artifact count unchanged; model cancellation during hashing prevents commit | Denial is a test control, not a native denial test |
| Sensitive/excluded | Separate synthetic window shows `SYNTHETIC-SECRET-513`; selecting its fixture ID rejects capture with no new occurrence | No OS window isolation/occlusion proof; own fixture pixels only |
| Duplicate | Two captures at 42s and 60s retain two IDs and one original hash; deleting one keeps the shared bytes | Exact-byte hash only; no perceptual dedup, OCR or quality threshold |
| Different bytes | Tiny PNG and generated slide retain two originals in the model check | Does not measure useful visual similarity |
| Restart | Reload retained original bytes and offsets, while clearing selection; final UI reports restored moments | Tab reload, not browser crash, power loss or production app restart |
| Missing/corrupt | Removing bytes leaves both occurrences visibly missing after reload; injected malformed bytes resolve corrupt in model check | No fallback/re-render/OCR substitute; a later explicit capture may restore identical bytes |
| Delete | Browser removal leaves the other occurrence; last reference deletion collects its original in the model check | No production trash/restore or backup-erasure guarantee |
| Offline | With loopback server stopped, already-loaded UI selected and saved moment 4 with the same hash; zero resource requests; model runs without network globals | Cold offline file launch remains manual; no system network settings changed |
| Write failure | Injected quota failure leaves no new in-memory occurrence or original; malformed persisted state is preserved | Browser transaction semantics, not filesystem fsync/crash durability |
| Stale async work | Cancel/selection change during digest discards result; overlapping captures rejected; observed other-tab changes block writes | Single-controller probe; storage-event guard is not a cross-process lock |
| OCR | `derivedOCR: null` retained separately in metadata; original always inspectable | OCR intentionally not evaluated; no accuracy claim or spoken attribution |

`node --test docs/research/dev-513/probe.test.mjs`: **11 passed, 0 failed**, Node 24.22.0. It extracts the exact inline model into a VM, supplies WebCrypto plus an in-memory storage adapter, and exercises the matrix’s error/lifecycle boundaries. Browser UI/storage checks are separate from those mocks. Existing desktop/store suites and build were not run: no production imports or files changed, and installing the full application was unnecessary for this research. Repository CI/CodeQL remain PR checks; these local checks do not replace them.

## UI evidence and usability findings

Actual prototype UI screenshots: [wide light](evidence/wide-light.png), [wide dark](evidence/wide-dark.png), [narrow light](evidence/narrow-light.png), [narrow dark](evidence/narrow-dark.png), [retained original/provenance](evidence/retained-original.png), [missing original](evidence/missing.png), [slide window](evidence/slide-window.png), [excluded window](evidence/excluded-window.png). CSS viewports were **1440×1000** and **390×844**; T3 scales screenshot output independently. Horizontal overflow measured false at both widths. Both themes were visually inspected. Narrow layout stacks controls and preview, requiring vertical scrolling to inspect evidence.

Keyboard checks used actual Tab/Enter/Escape events: initial Tab focused Choose with a 3px visible outline; Enter opened the dialog and focused its labeled select; Escape closed it, saved nothing and returned focus to Choose. Tab to confirm, Enter, then Enter on Capture completed the allowed flow. Deletion returns focus to Choose. Status uses a polite live region; controls and originals have accessible names. No screen-reader or physical-device qualification was performed. An attempted ArrowDown sequence did not change the macOS select value; the exclusion case was subsequently verified with the explicit select control and confirmed selected ID before capture. An incidental third allowed observation was deleted; the manifest retains the two intended comparison moments.

Observed design benefit: source and time remain inspectable even when the original is missing, and repeated slide observations are not collapsed. Observed cost: a deliberate choose/confirm/capture sequence takes three activations, and narrow screens separate the controls from evidence vertically. This is an agent-driven inspection, **not a usability study**; no task-time, reading-accuracy, capture-latency or note-quality improvement is claimed. A reload initially said “Nothing captured” despite retained content; the probe now explicitly announces restored moments, verified after correction.

## Production gates, kept separate from research acceptance

1. Human review and acceptance of this report and its native limitations. This completes the research decision only; it does not authorize rollout.
2. Separately approved native trial using only owned synthetic windows: verify one-window picker, cancel/deny/revoke, closed/replaced window, exclusion/occlusion, scale/color/cursor behavior, and no broad fallback or residual stream. Measure native latency and image fidelity against a declared fixture/threshold; do not infer quality from this canvas.
3. Bind frame acquisition to authoritative meeting/session monotonic time and scope. Reject late callbacks after meeting switch, Stop, deletion or library relocation. Preserve capture wall time separately; do not pretend it is speech timing.
4. Add an explicitly reviewed image/occurrence source contract after DEV-506 acceptance. Reuse its identity, resolve authoritative originals, reject stale/missing evidence, and preserve richer mobile fields. Do not promote scratch counters, browser origins or a second UUID to library identity.
5. Integrate local original/metadata durability with the current store and relocation barrier: bounded sizes, safe paths, atomic publication/recovery, failure rollback, restart, missing/disconnected library, deletion/reference ownership, and recovery-copy retention. Run existing desktop/store tests plus real native lifecycle QA when importing those helpers.
6. Review privacy and export separately: window titles/pixels may be sensitive; explicit one-shot local consent must not enroll content in sync, export or model processing. Any OCR remains labeled derived, versioned and removable without removing the original, and cannot assert a spoken commitment.
7. Human accessibility/usability evaluation and platform/version QA before separately authorized production work. Automatic capture, meeting adapters, uploads, system settings, releases and real meeting capture remain outside this spike.

**Check this:** Launch the command above; select the slide and capture twice at different offsets (two moments/one original). Cancel and deny (count unchanged); select excluded (rejected). Reload (originals/times retained; selection cleared). Remove original bytes (explicit missing), then delete all moments (zero originals). Repeat at both listed widths/themes and with keyboard-only picker navigation. Read the native limitation before accepting the report.

Remaining gate: Alec’s code/report review and Sean’s explicit acceptance, including acceptance of native/cold-offline/durability limitations; PR checks remain visible in GitHub. Keep Notion **In Review / Verification In progress** until required human gates are resolved. No merge, publication, release or watching is part of this lane.
