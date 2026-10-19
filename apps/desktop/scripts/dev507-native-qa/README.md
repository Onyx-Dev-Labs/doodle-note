# Contained DEV507 model evidence runner

Run only with an explicitly approved existing artifact. These scripts pin the exact read-only Qwen file authorized for this delivery; they do not search caches, download a model, launch Electron or open a personal profile. They are macOS QA helpers, not product code.

From the repository root:

```sh
python3 apps/desktop/scripts/dev507-native-qa/prepare.py
# Use only the fresh /private/tmp/dev507-native-* root just printed:
python3 apps/desktop/scripts/dev507-native-qa/launch.py /private/tmp/dev507-native-REPLACE
```

Preparation validates a regular non-symlink file, 0444 mode, exact byte length and SHA256, then creates isolated HOME/TMPDIR/model directories and copies the cached Node executable. A seatbelt policy denies network, personal file content, preferences and Apple Events, permits read-only access to this checkout and the exact model, and permits writes only inside the fresh root (plus null/fd streams). An outside-root synthetic sentinel verifies denial. No accounts, devices or native permissions are touched.

The launcher bundles `../dev507-native-evaluation.ts` from the checkout, records source SHA, runner/policy hashes, argv/environment and owned process-group PID, and enforces a 45-minute outer deadline. It rechecks the model's SHA, mode, length, inode and mtime after exit. The runner uses actual LocalNotesEngine and shared service with direct original I/O (not Electron/IPC), a fresh synthetic 701-original library and the immutable corpus hash. Its observer captures the exact system/history/user prompt, resolved wrapper, native token array/hash/context and temperature while forwarding the original prompt call unchanged. Full raw output, inclusion, admitted result and original integrity are retained per case.

The QA runner's 180-second per-case timer aborts the existing signal and awaits service/model ownership cleanup. Production deadlines remain unchanged. The outer process-group termination is last resort and must be reported as forced/interrupted; it is not a successful service-cancellation test. Three consecutive identical unclassified format/runtime failures pause the bounded run for diagnosis. The final authorized diagnostic slice restricts `sliceIds` to the frozen 20 must-find cases and explicitly classifies the two already diagnosed JSON/schema error messages; those classified outcomes remain failures and do not pause that slice. It stops after those 20 cases and never continues the remaining semantic cases. Failed cases stay in the denominator. `resume.json`, when used, must preserve completed records and explicit prior-attempt adjudication; do not replace a failed scored case with a successful retry.

`summary.json` reports completed and unperformed IDs, separate model/service/admission elapsed times (new runner), errors and human scoring as unperformed. Duration is an observed run measurement, not an isolated responsiveness benchmark, especially when other software checks overlap. Only a designated independent human can score semantic support. Native media, packaged app lifecycle, Windows and real capture remain separate gates.

After a clean launcher exit and matching model integrity records, run `python3 apps/desktop/scripts/dev507-native-qa/summarize.py ROOT OUTPUT.json`. It verifies corpus identity, unique case accounting, native wire/token budget equality and unchanged model provenance, then writes the summary and compressed full synthetic evidence packet. An inclusion hit is not a valid answer or a semantic quality pass.
