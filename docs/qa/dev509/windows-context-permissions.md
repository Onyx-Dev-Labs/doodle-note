# DEV509 Windows context permission regression

2026-10-19; test-only revision of PR232 above
`040f392bf37caebf66d1a20c4a1196d34a13fae6`. Production base remains
`f7f43c7d8a898a61015650b44a218167c1dedf76`; no rebase or production changes.

## Confirmed failure

[Windows CI run39286426178, job118173974930](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/39286426178/job/118173974930)
failed Desktop tests before installer build: 607 passed, one failed, 16 skipped
(624 total). The sole failure was `calendar-context-store.test.ts:147`, after
the provenance/restart assertions: mode `438` (`0666`) did not equal `384`
(`0600`). Run39170129105 at e1cabc8 failed at the same assertion. Original logs
remain `/tmp/dev509-ci-39286426178.log` and `/tmp/dev509-ci-39170129105.log`.

## Platform contract and correction

[Node 22 file modes](https://nodejs.org/docs/latest-v22.x/api/fs.html#file-modes)
do not implement Windows owner/group/other permission distinctions.
[Windows default file security](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
inherits ACLs from the parent directory. A reported `0666` is neither proof of
Everyone access nor proof of isolation.

The existing store creates a same-directory exclusive temporary file with mode
`0600`, flushes/verifies it, and atomically renames it. `LibraryStorage` defaults
to Electron userData; relocation creates a directory below the user-selected
parent. `prepareLibrary`, `LibraryStorage`, and `CalendarContextStore` do not
establish a separate Windows DACL policy. Windows protection therefore depends
on the selected directory's inherited policy. An arbitrary shared or externally
configured library is not promised to be private by this change.

All original store behavior assertions continue on Windows. The POSIX `0600`
assertion continues on POSIX. A Windows-only regression now:

1. Applies a protected DACL to this test's newly allocated temporary library,
   with exactly one inheritable Allow FullControl rule for the test user's SID.
2. Reads the root's actual security descriptor back, checking protection,
   exact rule count, SID, rights, allow type, inheritance and propagation flags.
3. Calls the real store, then inspects the created file's DACL. It must be
   unprotected with exactly that one inherited rule and no extra principal.
4. Changes the event through the real atomic replacement path, checks the DACL
   again, and reads both immutable observations and the incremented revision.

PowerShell errors, unavailable ACL inspection, timeout, or descriptor mismatches
fail the Windows test; there is no probe-failure skip. The store is disposed and
the temporary directory is removed. No user library, parent directory, global
permission, personal profile or production ACL is modified.

## Evidence and limits

Local macOS arm64 / Node24.22.0: the affected store test file passed 16 tests;
the single Windows DACL test was explicitly skipped on this non-Windows host.
These retain corrupt/future/wrong-scope/symlink preservation, missing canonical
marker, optimistic revision, exact-byte preservation, failed rename/fsync,
cancelled writes, relocation, historical corrections and original-link behavior.
Desktop node types, touched-file ESLint and diff checks passed. Software execution
used the existing guard that rejects node-llama-cpp/sherpa runtime imports.
Logs: `/tmp/dev509-windows-mode-fix/{focused,types,lint}.log`.

The hosted Windows run after this commit is the required execution evidence for
the new ACL regression and CI blocker resolution; local skips are not passes.
No installed-app ACL audit, multi-user impersonation test, custom/network-volume
qualification, native model/audio QA, inference or performance job was run.
This test checks DACL inheritance under an explicit synthetic root policy, not
an ACL guarantee for every user's chosen directory. Production remains gated OFF;
prior semantic failures, human review and other acceptance/release gates remain.

## Hosted harness follow-up

At `d35d77593c8cb53b2c413a50f2b30866729c24c6`,
[Windows job118186931475](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/39289732316/job/118186931475)
failed Desktop tests: 608 passed, one failed, 16 skipped. The original snapshot
test passed. The new DACL test failed during its first root setup, before any
store calls: `Set-Acl` reported `CouldNotAutoloadMatchingModule` for
`Microsoft.PowerShell.Security`. No root/file DACL assertion passed in that run.
The original job log remains `/tmp/dev509-windows-job-118186931475.log`.

The log identifies the workflow shell as `C:\Program Files\PowerShell\7\pwsh.EXE`;
the test launched Windows PowerShell (`powershell.exe`) through Node. Microsoft
documents [module autoload failure across this intermediate-process boundary](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-7.5).
Inherited PS7 module paths are consistent with this error; the old probe did not
emit the inner loader cause, so path versus execution-policy cause is not proven.
This is test-harness failure, not evidence of a production ACL defect.

The follow-up uses installed `pwsh.exe`, matching this workflow, and explicitly
imports its bundled security module from `PSHOME/Modules`. Plain-text diagnostics
include the shell version/home, exception and error ID; process launch/timeout
failures also fail visibly without dumping an encoded command. There is no shell
fallback, download, global policy/module-path change or Windows probe skip.
The restricted synthetic root readback and both exact inherited file descriptor
assertions are unchanged. Windows contributors need PowerShell 7 installed to
run this test, as the hosted Windows workflow already does.

Local follow-up: the affected store file again passes 16 tests on macOS, with
the one Windows-only test explicitly skipped. Desktop node types, touched-file
ESLint and diff checks pass; logs are `/tmp/dev509-windows-shell-fix/`. macOS
cannot execute this ACL branch. A new hosted Windows pass is still required;
all earlier failed evidence and remaining feature/native/human gates remain.
