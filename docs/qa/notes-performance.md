# Local notes performance

The local notes engine retains one context/sequence and the model weights across
requests. Each request creates a fresh chat session; llama 3.20.0 retains only the
exact token prefix and erases the divergent suffix before evaluation. Changes of
context size, failures, cancellation, model replacement, disposal and ten minutes
of inactivity release native state. Context size and foreground backend/fallback
selection are unchanged.

`NOTES_WARMUP_ENABLED` in `notes-service.ts` disables recording warm-up without a
Settings migration. After the speech engine reports ready, an unawaited task loads
the selected installed local model and preloads the selected template's system
prompt at llama evaluation priority 1 (foreground default is 5). Cloud, battery,
busy model service, missing selection and insufficient RAM skip it. This does not
change OS process priority or ASR settings. Capture does not wait for the task;
dictation and other foreground operations cancel it and wait for native cleanup
before using the same model. Generate joins the existing task, including its load,
and forwards cancellation/deadline to it. Warm-up never downloads a model.

Prefill renders the chat wrapper's system/user boundary with the same marker
technique used by node-llama-cpp 3.20.0, retaining its special tokens. It leaves
the final boundary token for foreground tokenization, then evaluates at most 64
tokens per native call, checking cancellation between calls. At the owner's
reported 47 tokens/sec this is about 1.36 seconds per batch; this is a sizing
estimate, not a new owner-device timing measurement. Native work always settles
before disposal or a queued foreground operation starts. Context allocation also
receives `createSignal`. Reading starts only after context allocation/fallback.
Discard/delete/trash cancels the matching meeting's job, and before-quit cleanup
requests cancellation before recording finalization. A normal Stop keeps warm-up
alive so Generate can join it.

The RAM guard requires the model's catalog minimum total RAM and free memory of
at least its file size plus 3 GiB for context, speech capture/ASR and the OS. This is
a conservative heuristic, not a measured allocation guarantee. Qwen 4B weights
alone are roughly 2.33 GB; its 16K KV context and native runtime add memory. Warm-up
holds these earlier than Generate would and releases them after ten idle minutes.
GPU/CPU contention can still affect timing; llama priority is not an OS real-time
guarantee. The field CPU-prefill pathology is deliberately unchanged for foreground work.
CPU-only warm-up loads weights but skips speculative prefill: on Dev04, Qwen 0.5B
failed to yield within two minutes at default settings and at one thread. The
`cpu-prefill` log reason records this guard. The guard runs again after context allocation/fallback and also excludes models
with zero offloaded GPU layers. Vulkan/Metal warm-up still preloads.
This avoids starting the known non-yielding CPU work while capture is active.

Prefix savings require identical tokens. Template or speaker-roster changes
invalidate the suffix beginning at the first difference; the current prompt puts
speaker rules early. A recording started with no known speakers may therefore
reuse only the initial rules, even after warming the complete system prompt.
Warm-up still avoids the model load, but first-note latency must be measured rather
than promised. Later identical templates/rosters reuse more of the prefix.

On Windows only, the profile's `model-integrity.json` caches at most 64 successful SHA-256 verdicts
(64 KiB maximum). Canonical path, size, mtime, ctime, device and inode must all match.
A changed stamp rehashes. Corruption or write failure falls back to verification;
partial-download markers always override cached verdicts. Each versioned receipt
has an HMAC-SHA256 over the canonical path, complete stamp, catalog digest and
schema version. A random 256-bit profile key is encrypted by Electron safeStorage
(Windows DPAPI), stored separately as `model-integrity.json.key`, and never written
into the verdict JSON. The production service injects secure storage only on
Windows, where DPAPI requires no authorization UI. The store accesses it lazily
from the receipt path, never during service construction. Unauthenticated or
mismatched receipts rehash. Unavailable/decryption-failing secure storage disables
persisted trust and rehashes on the first find; in-process verified results still work.

macOS and Linux receive no receipt-storage provider, even if a receipt/key already
exists. Electron's synchronous safeStorage methods can prompt for Keychain/keyring
authorization and block the main process on those platforms. Automatic model
discovery and recording warm-up therefore never call secure storage for receipts
there: they retain first-find SHA-256 verification per process and the in-memory
cache. Explicit cloud API-key storage is a separate, unchanged path.

Threat model: Windows-only persisted receipt trust uses HMAC to prevent trivially edited cache files from skipping model
verification. Same-user code execution is out of scope: it can already alter the
app's data and invoke the user's secure storage. File stamps remain a metadata
invalidation heuristic, not a cryptographic identity for arbitrary filesystem
attacks.

`<userData>/notes-engine.log` is JSON lines, rotated near 1 MiB with one `.old`
file. It records timestamps, model/backend/layers, load/hash/context timings,
prompt/evaluated/skipped tokens, prefill and decode rates, warm-up decisions,
fallback stages and timeouts. Rates count native tokens, not text chunks. Prefill
includes the first-token latency; decode rate excludes that first token. Skipped
tokens are bounded by the sequence's exact token match and the wrapped prompt
length minus actual evaluated input tokens. This avoids counting the native
sampling-token offset as a cache hit on a cold sequence. Model load and warm prefill also produce metrics.
No transcript, notes, prompt, file path, raw stack or raw exception message is
written. Exception messages are classified into fixed operational messages because
native/provider exceptions can contain user input; unknown details are omitted.
Logging is asynchronous, serialized, best-effort, and flushed at service disposal.

## Round 2 regression checks

`local-engine-native.test.ts` uses the real installed node-llama-cpp and an existing
small GGUF; set `DOODLENOTE_TEST_GGUF` to its absolute path before running the AI
suite. No model is downloaded. The test injects only GPU eligibility/context
failure while evaluating on CPU, so it validates the shared cancellation and
prefix mechanics without claiming Vulkan/Metal performance. It aborts at native
batch entry with foreground generation queued, proves exactly one 64-token batch
finishes, checks all 899 warmed tokens match and are reused by `runRaw`, and checks
CPU fallback does zero speculative evaluation then produces a foreground token.
The synthetic one-token output budget intentionally returns the normal
output-limit error after real generation. Without a GGUF path, CI skips this
opt-in test; Linux and native Dev04 evidence runs enable it.

## Round 3 regression checks

`notes-service-receipts.test.ts` runs the production service constructor, models
IPC and recording warm-up selection with the real model store, a synthetic model,
and stubbed platform/native boundaries. Six cases cover discovery and warm-up on
`darwin`, `linux` and `win32`. A prior Windows service writes a valid receipt; new
macOS/Linux instances ignore it, hash the model and make zero safeStorage calls.
Windows reuses the receipt. All platforms retain in-process verification, and
service construction never calls safeStorage. Existing store tests retain
unavailable-storage, decryption-failure and forged-receipt coverage.

## Round 4: recording roster alignment and power observations

The owner’s J2 field log showed 598 warmed tokens but only 112 reused. The warm-up
read the empty transcript at recording ready; generation read a mic transcript
with a `You` speaker. With the real Qwen3 tokenizer and automatically selected
Qwen3 wrapper, the first differing token is index 112 (zero-based): `;` versus
` (` in these unchanged speaker rules:

- Empty roster: `- "You" is the note-taker; "Them" is everyone else on the call.`
- Mic roster: `- "You" is the note-taker (the DoodleNote user).` followed by
  `- "Them" is everyone else on the call.`

Capture now carries its selected source through the accepted `started` event to
`ready`. Warm-up resolves that source’s channel labels with the same speaker-label
resolver as generation, including participant names already saved on the meeting.
Existing non-echo speakers are retained first for resumed recordings. Only the
speculative inputs change: no invented transcript is saved, and foreground prompt
text, role placement, template selection and note-quality instructions are unchanged.
Names/templates changed later, newly identified speakers, or an enabled channel
that never speaks can still require normal prefix realignment. Full reuse applies
when the predicted roster and template match the final request.

The opt-in desktop regression runs actual NotesService warm-up and foreground
input construction, then LocalNotesEngine warm/runRaw with a real Qwen3 GGUF,
real native evaluation and the automatically selected Qwen3 wrapper. CPU hardware
injects only GPU eligibility to enter warm-up. It asserts reuse through the entire
rendered system turn and equality of all warmed tokens. Qwen3-0.6B Q8_0 reproduces
the field’s token-112 divergence and reuses 605/605 warmed tokens after the fix,
covering the 603-token rendered system turn. This tests the mechanism, not the
owner’s Qwen3-4B Vulkan speed. Set `DOODLENOTE_TEST_QWEN_GGUF` to a local Qwen3 GGUF;
no model is downloaded by the suite. The six always-on roster cases cover mic,
system and both channels with default and named speakers, including system-first
speech for the two-channel case.

The battery gate was already called at recording ready, directly through
`powerMonitor.isOnBatteryPower()`, with true meaning skip. There is no app-cached
power state or Windows-specific bypass. The integration regression exercises the
actual started/ready callback with battery changing after service construction:
battery creates no engine, then AC permits warm-up. Native Electron 44.10.0 on
Dev04 reports both `isOnBatteryPower()` and `onBatteryPower` as false on AC. This
cannot establish the owner’s historical power state; they may have been plugged
in at that instant or switched to battery after warm-up started. This gate is a
start-time check, not an unplug-during-warm-up cancellation policy.

New diagnostics persist `onBatteryPower` as a boolean on `warmup/start`, and
`warmup/skipped` with `why: "battery"` and `onBatteryPower: true` on battery skips.
Other skips also use `reason: "skipped"` and `why`. Runtime acquisition now records
`runtimeMs` (dynamic import plus getLlama). Context creation remains after model
load because it requires the loaded model; no speculative overlap is introduced.

At the owner’s measured ~54 prompt tokens/s, avoiding roughly 493 repeated tokens
would save about 9 seconds of foreground prefill, leaving roughly 3 seconds for
the actual user message instead of 12.3 seconds. With the same Generate timing,
load and decode rates, roughly 60 seconds total is an estimate versus 69 seconds;
recordings long enough to finish warm-up before Generate should hide more setup.
On battery, warm-up is deliberately skipped. No new owner-device timing is claimed.

## Round 7: field J4 memory, context and preparation

Recording warm-up now resolves the verified installed artifact, reads its GGUF
architecture metadata, and admits fully resident model-file bytes plus f16 KV
(`2 * layers * KV heads * (key dimension + value dimension) * context tokens`)
plus **1 GiB** headroom. Capture/ASR is already running when available memory is
sampled; the extra GiB covers its growth, native graph/work buffers and OS activity.
Weights are counted in full even with mmap, and GPU memory is not subtracted on
UMA. Unknown metadata/architectures skip speculative work. Gemma's sliding window
is conservatively counted as full-context KV in every layer. Existing model RAM
eligibility, battery, busy, cancellation and CPU-prefill gates remain in effect.
This is a conservative admission estimate, not an OS memory reservation.

Qwen3-4B's catalog artifact is 2,497,281,120 bytes. Its metadata (36 layers,
8 KV heads, 128-dimensional keys and values) gives 144 KiB/token: **1.125 GiB**
at 8K, versus **2.25 GiB** at 16K. The default short-meeting warm-up therefore
requires about **4.451 GiB / 4,558 MiB**, including headroom, rather than the old
5.4 GiB gate. A retained larger context is estimated at its actual size. Available
memory is checked again after asynchronous metadata inspection, before loading.
`freeMB`, `requiredMB`, `totalMB` and `contextSize` are content-free diagnostics;
MB fields use MiB. Skips before artifact inspection (battery/cloud/busy/no model)
omit unknown `requiredMB` rather than inventing an estimate.

Windows `os.freemem()` uses libuv's `GlobalMemoryStatusEx().ullAvailPhys`.
[Microsoft documents](https://learn.microsoft.com/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)
that this includes standby, free and zero lists, immediately reusable without
writing to disk. The Dev04 native Node/koffi probe directly compares both calls.

Adaptive foreground allocation counts the actual tokenizer and automatic chat
wrapper, including system/user/assistant framing, then chooses **4096, 8192 or
16384**, reserving the existing output cap and 256 safety tokens. Ordinary notes
retain the 4096-token output ceiling, so even a short meeting needs 8K; 4K serves
smaller explicitly bounded outputs. Warm-up predicts a typical short meeting
(roughly 1024 transcript tokens plus the normal system prompt and output budget)
with 8K. Adaptive requests grow the context only when necessary, retaining larger
contexts and the common prefix on later shorter requests. Growth discards the old
KV and naturally re-prefills once. Explicit caller context limits are still honored,
including smaller dictation budgets. Global Ask keeps its 16K evidence-selection
budget. Existing 48K-character single-pass/36K-character map chunks/40K-character
reduce budgets remain capped at the same 16K maximum, and recipes still perform
exact wrapped-token fit validation against the allocated context. The existing
long-meeting map-reduce and output-limit behavior is unchanged.

J4's unexplained interval is 7,876 ms minus runtimeMs 2,271 ms = **5,605 ms**.
The old `prepareModel` awaited the first dynamic `node-llama-cpp` module import
_before_ `acquireRuntime` started its timer. With a verified local model path,
resolution performs no download. This identifies the uninstrumented import
boundary; the old log cannot independently attribute every millisecond of laptop
scheduling or disk/Defender delay. New `prepare` events time `warm-wait`,
`model-lookup`, `engine-queue`, `module-import`, `model-resolve` and `footprint`.
Module import starts alongside integrity lookup, removing that avoidable serial
ordering. It does not initialize the backend or load weights. The earlier round-4
claim that runtimeMs covered first import was incorrect and is superseded here.

node-llama-cpp **3.20.0** exposes `experimentalKvCacheKeyType` and
`experimentalKvCacheValueType` (`Q8_0`), but its public declarations mark them
experimental/highly unstable and warn of incorrect behavior or process crashes.
Support depends on the model, backend and flash-attention path. No native
quality/speed matrix establishes safe Vulkan/Metal/CPU use here, so f16 remains
unchanged. No model catalog, default model, prompt rules or generation cap changed.

Owner diagnostic v4 lives beside v3 in the QA tools directory. It uses the installed
app's Node mode and installed GGUF, writes only under the logged-in user's
LocalApplicationData\Temp, rejects SYSTEM and a running DoodleNote, prints a compact
partial-results table, and enforces 90 seconds per process and 900 seconds total.
Eight independent cases cover Vulkan auto/24 and CPU 0 layers with mmap on/off,
plus CPU 4/8 threads; every case times 4K/8K/16K context creation, an ~800-token
synthetic prompt and 100 decode tokens. Decode continues through EOG for fixed
throughput; this is not a note-quality test. A supervisor can terminate only its
own worker process tree. v3 is retained. Dev04 blocks unsigned PowerShell scripts;
the v4 execution attempt is recorded as blocked, and no policy/security bypass was
used. Static PowerShell and worker-JS syntax checks do not substitute for that dry-run.
