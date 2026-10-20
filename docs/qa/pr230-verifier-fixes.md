# PR230 verifier follow-up to immutable 4fd6139 review

Review baseline: `4fd6139dad4961582192989272f317717654a538`; no history rewritten. This follow-up changes verifier/tests/docs only. Core `ab8987c` and version0.4.35 remain unchanged. No workflow dispatch, signing, publication, model, GUI or packaged-native execution.

The independent standards review reported **0 meaningful findings** at4fd6139. The separate spec review reproduced **two P2 verifier defects**, with no core/version finding. These are distinct axes; standards success did not close the spec findings. Reports and pins were read in full: `/tmp/pr230-review-4fd6139-6141f382/report.md`, `/tmp/dn230-review-4049579c/REPORT.md`, `reproduce.py`, `probes.log`, `pins.json`. Parent commissions fresh independent verification after fixes; no human approval is inferred.

## F1 — descendants outliving their invocation

RED at4fd6139: five new regressions produced four failures. Both exit3 and exit0 parents left a pipe-redirected child alive, which wrote a marker after `run()` returned. Cleanup-error reporting was absent and cleanup errors could not fail a successful command. The timeout control already passed. Every test cleaned up its own child and unrelated sentinel in `finally`.

Fix commit: `05b120c3a4fd329b2d853519fd879506a60e94f2`. Each command still owns a new process group; all exit paths now terminate that group, reap the direct child and wait within a two-second cleanup deadline for the group to disappear. Only that invocation's group is targeted; no process-name scans. Output is captured in temporary files and collected after cleanup, so surviving inherited pipes cannot hang output collection. Timeout/nonzero failures remain primary and their output is logged even if cleanup fails; cleanup failure after exit0 fails verification. This is process ownership/cleanup, not a sandbox guarantee.

GREEN:27 Python verifier tests passed,0 skips, including redirected descendants after normal/failing/timeout parent exits, inherited-output timeout, unrelated-process survival, original diagnostic preservation, cleanup failure and bounded group drain. Local evidence: `/tmp/dn230-f1-red.txt`, `/tmp/dn230-f1-green.txt`.

## F2 — channel identity

The independent full-pipeline probe accepted duplicated440Hz mic content as the expected660Hz system channel. This is a verifier false positive, not evidence of a production engine duplication defect.

RED against F1 commit `05b120c3a4fd329b2d853519fd879506a60e94f2`:31 tests produced8 assertion failures (no errors). Six full-`audio_smoke()` controls accepted duplicated/swapped/wrong non-silent channels at split and merge boundaries; the distinct merge fixture assertion failed; equally mixed tones were accepted. The initial local test setup corrupted the WAV header before a later synthetic conversion; that setup error was corrected to append bytes while keeping decodable PCM before recording the clean RED run.

Fix: split outputs must retain mic440Hz/system660Hz identity, and merge now uses separate440Hz/660Hz CAF inputs. The central half-second of each decoded channel must contain at least75% energy at its expected tone. Quadrature correlation is phase/gain independent; centering removes DC and avoids codec edge padding. Valid controls include reduced gain, changed phase, DC, deterministic noise, edge padding and±0.5Hz drift. Duplicate, swapped, wrong non-silent and equal-mixture controls reject. This measures deterministic fixture identity, not perceptual audio quality. Protocol/completion, duration/format/non-silence, success checkpoint removal, corrupt-checkpoint preservation and source-byte checks remain; the latter now also covers system WAV and MP4.

GREEN:31 Python tests passed,0 skips. Full audio protocol/preservation controls use synthetic command responses and PCM fixtures; no afconvert, packaged engine, native codec or app executed. Actual AAC/resampling tolerance remains subject to the exact-artifact runtime gate. Local evidence: `/tmp/dn230-f2-red.txt`, `/tmp/dn230-f2-green.txt`. The final pushed F2 SHA is recorded in PR230 and the handoff, rather than self-referencing a commit in its own contents.

## Combined follow-up validation and limits

Python31; Node protocol/lifecycle10; workflow Ruby3/34 assertions; manifest Ruby4/5 assertions: all passed,0 skips. Touched Python syntax and diff whitespace checks passed. No broad AI/desktop rerun for this script-only change; prior core/version evidence remains pinned to its original source. Independent verification of these fixes, human approval, fresh0.4.35 signing and real macOS14 exact-artifact execution remain pending. No production engine duplication is inferred from synthetic verifier counterexamples.
