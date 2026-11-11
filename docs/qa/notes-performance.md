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

The RAM guard requires the model's catalog minimum total RAM and free memory of
at least its file size plus 3 GiB for context, speech capture/ASR and the OS. This is
a conservative heuristic, not a measured allocation guarantee. Qwen 4B weights
alone are roughly 2.33 GB; its 16K KV context and native runtime add memory. Warm-up
holds these earlier than Generate would and releases them after ten idle minutes.
GPU/CPU contention can still affect timing; llama priority is not an OS real-time
guarantee. The field CPU-prefill pathology is deliberately unchanged.

Prefix savings require identical tokens. Template or speaker-roster changes
invalidate the suffix beginning at the first difference; the current prompt puts
speaker rules early. A recording started with no known speakers may therefore
reuse only the initial rules, even after warming the complete system prompt.
Warm-up still avoids the model load, but first-note latency must be measured rather
than promised. Later identical templates/rosters reuse more of the prefix.

The profile's `model-integrity.json` caches at most 64 successful SHA-256 verdicts
(64 KiB maximum). Canonical path, size, mtime, ctime, device and inode must all match.
A changed stamp rehashes. Corruption or write failure falls back to verification;
partial-download markers always override cached verdicts.
