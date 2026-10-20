# PR230 verifier follow-up to immutable 4fd6139 review

Review baseline: `4fd6139dad4961582192989272f317717654a538`; no history rewritten. This follow-up changes verifier/tests/docs only. Core `ab8987c` and version0.4.35 remain unchanged. No workflow dispatch, signing, publication, model, GUI or packaged-native execution.

The independent standards review reported **0 meaningful findings** at4fd6139. The separate spec review reproduced **two P2 verifier defects**, with no core/version finding. These are distinct axes; standards success did not close the spec findings. Reports and pins were read in full: `/tmp/pr230-review-4fd6139-6141f382/report.md`, `/tmp/dn230-review-4049579c/REPORT.md`, `reproduce.py`, `probes.log`, `pins.json`. Parent commissions fresh independent verification after fixes; no human approval is inferred.

## F1 — descendants outliving their invocation

RED at4fd6139: five new regressions produced four failures. Both exit3 and exit0 parents left a pipe-redirected child alive, which wrote a marker after `run()` returned. Cleanup-error reporting was absent and cleanup errors could not fail a successful command. The timeout control already passed. Every test cleaned up its own child and unrelated sentinel in `finally`.

Fix: each command still owns a new process group; all exit paths now terminate that group, reap the direct child and wait within a two-second cleanup deadline for the group to disappear. Only that invocation's group is targeted; no process-name scans. Output is captured in temporary files and collected after cleanup, so surviving inherited pipes cannot hang output collection. Timeout/nonzero failures remain primary and their output is logged even if cleanup fails; cleanup failure after exit0 fails verification. This is process ownership/cleanup, not a sandbox guarantee.

GREEN:27 Python verifier tests passed,0 skips, including redirected descendants after normal/failing/timeout parent exits, inherited-output timeout, unrelated-process survival, original diagnostic preservation, cleanup failure and bounded group drain. Local evidence: `/tmp/dn230-f1-red.txt`, `/tmp/dn230-f1-green.txt`.

## F2 — channel identity

The independent full-pipeline probe accepted duplicated440Hz mic content as the expected660Hz system channel. This is a verifier false positive, not evidence of a production engine duplication defect. F2 remains open at this F1 commit; the subsequent focused audio-check change will record its own RED/GREEN evidence here.
