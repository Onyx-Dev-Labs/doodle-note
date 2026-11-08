; Guards for the install folder migration in windows-installer.nsh, kept in their
; own file so scripts/test-windows-installer-guards.cjs can compile them into a
; test harness and check them against real folders, links and processes.
;
; Needs these defines: APP_FILENAME (the old folder name, the package name),
; PRODUCT_FILENAME (the new folder name), DN_APP_EXE (the app's exe name in
; both) and DN_UNINSTALLER_EXE (its uninstaller's; electron-builder's
; APP_EXECUTABLE_FILENAME and UNINSTALL_FILENAME are defined only after this file
; is compiled), and DN_MIGRATION_IDENTITY (what a journal must name). The
; installer and the harness set $dnProgramsRoot, $dnProfileDir, $dnJournalKey,
; $dnStateKey, $dnUninstallKey and $dnUninstallKey2 (all HKCU), and $dnStatusKey
; and $dnStatusLog (where decisions are recorded, dnStatus; "" = not recorded),
; before calling the functions below.
;
; electron-builder compiles the installer and the uninstaller separately (the
; uninstaller with BUILD_UNINSTALLER, where every function must be named un.*).
; The uninstaller gets the closer and, with DN_WITH_UNINSTALL_LEGACY, the path and
; removal functions for dnUninstallLegacy. A function that is compiled but never
; called is a warning, which -WX makes an error, so each pass compiles only what
; it calls.

!include LogicLib.nsh
!include FileFunc.nsh

!ifdef BUILD_UNINSTALLER
  !define DN_FN "un."
  !ifdef DN_WITH_UNINSTALL_LEGACY
    !define DN_PATH_FUNCTIONS
  !endif
!else
  !define DN_FN ""
  !define DN_PATH_FUNCTIONS
!endif

; !insertmacro dnTestStep NAME, right after a registry write that a later run must
; be able to pick up from. Nothing in an installer. A harness build with
; DN_TEST_STEPS (scripts/test-windows-installer-guards.cjs, never an installer)
; terminates the process there when $dnTestStopAt is NAME: an installer killed
; between two writes.
!ifdef DN_TEST_STEPS
  Var dnTestStopAt
  !macro dnTestStep NAME
    ${if} $dnTestStopAt == "${NAME}"
      System::Call 'kernel32::TerminateProcess(p -1, i 9)'
    ${endif}
  !macroend
!else
  !macro dnTestStep NAME
  !macroend
!endif

; !insertmacro dnFlushRegistry, after the writes a later run depends on (the journal's
; Identity, the record, a complete recovery copy, a restored record): a registry
; write survives the process being killed right after it, but sits in memory until
; Windows writes the hive out (seconds later). RegFlushKey writes HKCU out now, so a
; power loss right after that point does not lose it either. It is not a
; transaction: a power loss between two writes still leaves what the next run's
; checks were built for (an incomplete journal, a missing record).
!macro dnFlushRegistry
  System::Call 'advapi32::RegFlushKey(i 0x80000001)'
!macroend

!define DN_ATTR_DIRECTORY 0x10
!define DN_ATTR_REPARSE_POINT 0x400
; FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT
!define DN_OPEN_NO_FOLLOW 0x02200000
; DELETE | FILE_READ_ATTRIBUTES
!define DN_ACCESS_DELETE 0x10080
!define DN_POWERSHELL "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
; Wall-clock limits for the closer (dnRunHidden); past them it is stopped and its
; answer is "unknown", the conservative path.
!define /ifndef DN_CLOSE_FIND_TIMEOUT_MS 30000
!define /ifndef DN_CLOSE_TIMEOUT_MS 45000

; Finds the processes whose executable is exactly $env:DN_CLOSE_EXE (full path,
; case-insensitive; no prefix or image-name matching) through Win32_Process,
; which works from the 32-bit installer. Exit 0: none (left) running. Exit 10:
; some still running (DN_CLOSE_MODE=find, or they survived closing). Any other
; exit: identity could not be established (no PowerShell or CIM, or a process
; with this image name in this session whose path cannot be read). With
; DN_CLOSE_MODE=close it asks each one to close (CloseMainWindow), waits up to
; 5 s, then stops only the PIDs that still match, and waits up to 5 s more.
; Paths reach the script through the environment, never through its text. Every
; CIM query has -OperationTimeoutSec 10 and the whole script a 25 s budget (then
; exit 3: unknown); dnRunHidden also stops it after DN_CLOSE_FIND_TIMEOUT_MS /
; DN_CLOSE_TIMEOUT_MS. The harness overrides DN_CLOSE_PS to simulate a stall.
!ifndef DN_CLOSE_PS
!define DN_CLOSE_PS `$$ErrorActionPreference='Stop'; try { $$budget = [Diagnostics.Stopwatch]::StartNew(); $$want = [IO.Path]::GetFullPath($$env:DN_CLOSE_EXE); $$name = [IO.Path]::GetFileName($$want); $$session = (Get-Process -Id $$PID).SessionId; function ours { if ($$budget.Elapsed.TotalSeconds -gt 25) { throw 'budget' }; $$o = @(); foreach ($$p in @(Get-CimInstance -ClassName Win32_Process -OperationTimeoutSec 10 | Where-Object { $$_.Name -eq $$name })) { if (-not $$p.ExecutablePath) { if ($$p.SessionId -eq $$session) { throw 'unreadable' }; continue }; if ([IO.Path]::GetFullPath($$p.ExecutablePath) -eq $$want) { $$o += [int]$$p.ProcessId } }; ,$$o }; $$ids = ours; if ($$ids.Count -eq 0) { exit 0 }; if ($$env:DN_CLOSE_MODE -ne 'close') { exit 10 }; foreach ($$i in $$ids) { try { [void](Get-Process -Id $$i).CloseMainWindow() } catch { } }; for ($$t = 0; $$t -lt 20 -and (ours).Count; $$t++) { Start-Sleep -Milliseconds 250 }; foreach ($$i in (ours)) { Stop-Process -Id $$i -Force -ErrorAction SilentlyContinue }; for ($$t = 0; $$t -lt 20 -and (ours).Count; $$t++) { Start-Sleep -Milliseconds 250 }; if ((ours).Count) { exit 10 }; exit 0 } catch { exit 3 }`
!endif

Var dnCloseResult
Var dnClosePolicy
Var dnLockHandle
Var dnLocked

; How to treat our running app: "close" when the app asked for this install
; (--updated), "ask" interactively, "never" for a silent install nobody asked the
; app for (/S without --updated): nothing is closed without consent.
!macro dnClosePolicy OUT
  ${if} ${isUpdated}
    StrCpy ${OUT} "close"
  ${elseif} ${Silent}
    StrCpy ${OUT} "never"
  ${else}
    StrCpy ${OUT} "ask"
  ${endif}
  !ifdef DN_TEST_ASK_CANCEL
    ${if} $dnTestAsk == "1"
      StrCpy ${OUT} "ask"
    ${endif}
  !endif
!macroend

; A harness-only build with DN_TEST_ASK_CANCEL (scripts/test-windows-uninstaller-hooks.nsi,
; never an installer) runs silently with $dnTestAsk = "1": the policy is "ask" and the
; prompt answers Cancel by itself, as a user who clicked Cancel would.
!ifdef DN_TEST_ASK_CANCEL
  Var dnTestAsk
  !define DN_ASK_ANSWER "/SD IDCANCEL"
!else
  !define DN_ASK_ANSWER ""
!endif

; Closes the app running from exactly DIR\DN_APP_EXE. RESULT: none,
; closed, running (still running: not allowed, or survived closing), unknown
; (identity could not be established, including a closer that timed out) or
; cancel (the user said no).
!macro dnCloseAppIn DIR POLICY RESULT
  System::Call 'kernel32::SetEnvironmentVariableW(w "DN_CLOSE_EXE", w "${DIR}\${DN_APP_EXE}")'
  System::Call 'kernel32::SetEnvironmentVariableW(w "DN_CLOSE_MODE", w "find")'
  Push `"${DN_POWERSHELL}" -NoProfile -NonInteractive -Command "${DN_CLOSE_PS}"`
  Push ${DN_CLOSE_FIND_TIMEOUT_MS}
  Call ${DN_FN}dnRunHidden
  Pop ${RESULT}
  ${if} ${RESULT} == "0"
    StrCpy ${RESULT} "none"
  ${elseif} ${RESULT} == "10"
    StrCpy ${RESULT} "running"
    ${if} ${POLICY} == "ask"
      ${if} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" ${DN_ASK_ANSWER} IDOK`
        StrCpy ${RESULT} "close"
      ${else}
        StrCpy ${RESULT} "cancel"
      ${endif}
    ${elseif} ${POLICY} == "close"
      StrCpy ${RESULT} "close"
    ${endif}
    ${if} ${RESULT} == "close"
      DetailPrint "$(appClosing)"
      System::Call 'kernel32::SetEnvironmentVariableW(w "DN_CLOSE_MODE", w "close")'
      Push `"${DN_POWERSHELL}" -NoProfile -NonInteractive -Command "${DN_CLOSE_PS}"`
      Push ${DN_CLOSE_TIMEOUT_MS}
      Call ${DN_FN}dnRunHidden
      Pop ${RESULT}
      ${if} ${RESULT} == "0"
        StrCpy ${RESULT} "closed"
      ${elseif} ${RESULT} == "10"
        StrCpy ${RESULT} "running"
      ${else}
        StrCpy ${RESULT} "unknown"
      ${endif}
    ${endif}
  ${else}
    StrCpy ${RESULT} "unknown"
  ${endif}
  System::Call 'kernel32::SetEnvironmentVariableW(w "DN_CLOSE_EXE", p 0)'
  System::Call 'kernel32::SetEnvironmentVariableW(w "DN_CLOSE_MODE", p 0)'
  DetailPrint "${PRODUCT_NAME} in ${DIR}: ${RESULT}"
!macroend

; Push COMMANDLINE; Push TIMEOUT_MS; Call dnRunHidden; Pop RESULT: the exit code of
; COMMANDLINE run without a window, "timeout" when it did not finish in TIMEOUT_MS
; (it is then terminated: it is our own child process), or "error" when it could
; not be started. Unlike nsExec, a stalled child (a WMI provider that never
; answers) cannot hang the installer or uninstaller.
Function ${DN_FN}dnRunHidden
  Exch $1
  Exch
  Exch $0
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  ; STARTUPINFOW (cb only; 68 bytes for a 32-bit installer, 104 for 64-bit) and
  ; PROCESS_INFORMATION, zero-filled.
  System::Alloc 128
  Pop $2
  !if ${NSIS_PTR_SIZE} > 4
    System::Call '*$2(i 104)'
  !else
    System::Call '*$2(i 68)'
  !endif
  System::Alloc 32
  Pop $3
  ; CREATE_NO_WINDOW; the child inherits this process's environment.
  System::Call 'kernel32::CreateProcessW(p 0, w r0, p 0, p 0, i 0, i 0x08000000, p 0, p 0, p r2, p r3) i.r4'
  ${if} $4 = 0
    StrCpy $0 "error"
  ${else}
    System::Call '*$3(p .r5, p .r6)'
    System::Call 'kernel32::CloseHandle(p r6)'
    System::Call 'kernel32::WaitForSingleObject(p r5, i r1) i.r7'
    ${if} $7 = 0
      System::Call 'kernel32::GetExitCodeProcess(p r5, *i .r7) i.r4'
      ${if} $4 = 0
        StrCpy $0 "error"
      ${else}
        StrCpy $0 $7
      ${endif}
    ${else}
      System::Call 'kernel32::TerminateProcess(p r5, i 1)'
      System::Call 'kernel32::WaitForSingleObject(p r5, i 5000)'
      StrCpy $0 "timeout"
    ${endif}
    System::Call 'kernel32::CloseHandle(p r5)'
  ${endif}
  System::Free $2
  System::Free $3
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Exch $0
  Exch
  Pop $1
FunctionEnd

; OUT = 1 when EXE exists and cannot be opened for writing (a running image is
; locked). Used only when the closer cannot tell; it never closes anything.
!macro dnExeLocked EXE OUT
  StrCpy ${OUT} "0"
  ${if} ${FileExists} "${EXE}"
    ClearErrors
    FileOpen $dnLockHandle "${EXE}" a
    ${if} ${Errors}
      StrCpy ${OUT} "1"
    ${else}
      FileClose $dnLockHandle
    ${endif}
  ${endif}
!macroend

; Files are about to be replaced in DIR: make sure nothing runs from it. Asks to
; retry while the app cannot be closed; a silent run quits instead (error level
; 2) rather than overwrite files in use.
!macro dnEnsureNotRunning DIR
  ${do}
    !insertmacro dnCloseAppIn "${DIR}" $dnClosePolicy $dnCloseResult
    ${if} $dnCloseResult == "cancel"
      !ifdef DN_PATH_FUNCTIONS
        !insertmacro dnStatus close cancelled user-cancelled "in=${DIR}"
      !endif
      Quit
    ${endif}
    ${if} $dnCloseResult == "unknown"
      !insertmacro dnExeLocked "${DIR}\${DN_APP_EXE}" $dnLocked
      ${if} $dnLocked == "0"
        ${break}
      ${endif}
    ${elseif} $dnCloseResult != "running"
      ${break}
    ${endif}
    ${if} ${Silent}
      DetailPrint `"${PRODUCT_NAME}" is running from ${DIR} and was not closed`
      !ifdef DN_PATH_FUNCTIONS
        !insertmacro dnStatus close exit-2 app-running "in=${DIR}"
      !endif
      SetErrorLevel 2
      Quit
    ${endif}
    ${ifnot} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" IDRETRY`
      !ifdef DN_PATH_FUNCTIONS
        !insertmacro dnStatus close cancelled user-cancelled "in=${DIR}"
      !endif
      Quit
    ${endif}
  ${loop}
!macroend

!ifdef DN_PATH_FUNCTIONS
  Var dnProgramsRoot
  Var dnProfileDir
  Var dnJournalKey
  Var dnPlanNote
  ; Handles dnPinLegacy holds from before the old folder is checked until it is
  ; removed (dnUnpin), and the identities dnRemoveTreeAt must never enter.
  Var dnPinRoot
  Var dnPinParent
  Var dnPinProfile
  Var dnPinDest
  Var dnProtectProfile
  Var dnProtectDest

  ; Diagnostics. A one-click installer shows no details and keeps no log, so each
  ; decision is recorded where QA (or support) can read it afterwards:
  ; LastRun (UTC), LastStep, LastResult and LastReason (short machine-readable
  ; codes, listed in docs/WINDOWS-RELEASE-QA.md) under HKCU\$dnStatusKey, and the
  ; same as one line appended to $dnStatusLog (UTF-16, past 64 KiB it becomes
  ; <log>.1 and a new one starts). Nothing else is written: no user data, and the
  ; only paths are the install and old install folders. "" turns either off.
  Var dnStatusKey
  Var dnStatusLog
  ; The code for the reason the last guard refused (dnCheckLegacyDir, dnPinLegacy,
  ; dnTrustedJournal, dnCheckUninstallCommand, dnPlanMigration).
  Var dnWhy

  !macro dnFail OUT CODE TEXT
    StrCpy ${OUT} "${TEXT}"
    StrCpy $dnWhy "${CODE}"
  !macroend

  !ifdef BUILD_UNINSTALLER
    !define DN_STATUS_PROGRAM "uninstaller"
  !else
    !define DN_STATUS_PROGRAM "installer"
  !endif
  !ifdef VERSION
    !define DN_STATUS_VERSION " version=${VERSION}"
  !else
    !define DN_STATUS_VERSION ""
  !endif

  ; Push STEP; Push RESULT; Push REASON; Push DIRS; Call dnStatus. Records one
  ; decision (see above). STEP "note" goes to the log only. DIRS is "" or
  ; "from=<old> to=<new>"-style text naming only the install folders. Never fails
  ; the run and leaves the error flag as it was.
  Function ${DN_FN}dnStatus
    Exch $3
    Exch
    Exch $2
    Exch 2
    Exch $1
    Exch 3
    Exch $0
    Push $4
    Push $5
    Push $6
    Push $7
    Push $8
    Push $9
    StrCpy $8 "0"
    ${if} ${Errors}
      StrCpy $8 "1"
    ${endif}
    ${if} $dnStatusKey != ""
    ${orIf} $dnStatusLog != ""
      ; UTC now, from SYSTEMTIME (year, month, day of week, day, hour, minute, second).
      System::Alloc 16
      Pop $4
      System::Call 'kernel32::GetSystemTime(p r4)'
      System::Call '*$4(&i2 .r5, &i2 .r6, &i2, &i2 .r7)'
      IntFmt $6 "%02u" $6
      IntFmt $7 "%02u" $7
      StrCpy $9 "$5-$6-$7"
      System::Call '*$4(&i2, &i2, &i2, &i2, &i2 .r5, &i2 .r6, &i2 .r7)'
      System::Free $4
      IntFmt $5 "%02u" $5
      IntFmt $6 "%02u" $6
      IntFmt $7 "%02u" $7
      StrCpy $9 "$9T$5:$6:$7Z"
      ${if} $dnStatusKey != ""
      ${andIf} $0 != "note"
        WriteRegStr HKCU $dnStatusKey "LastRun" $9
        WriteRegStr HKCU $dnStatusKey "LastStep" $0
        WriteRegStr HKCU $dnStatusKey "LastResult" $1
        WriteRegStr HKCU $dnStatusKey "LastReason" $2
      ${endif}
      ${if} $dnStatusLog != ""
        ClearErrors
        FileOpen $4 $dnStatusLog r
        ${ifNot} ${Errors}
          FileSeek $4 0 END $5
          FileClose $4
          ${if} $5 > 65536
            Delete "$dnStatusLog.1"
            Rename $dnStatusLog "$dnStatusLog.1"
          ${endif}
        ${endif}
        ClearErrors
        FileOpen $4 $dnStatusLog a
        ${ifNot} ${Errors}
          FileSeek $4 0 END $5
          ${if} $5 = 0
            FileWriteWord $4 0xFEFF
          ${endif}
          StrCpy $6 "$9 ${DN_STATUS_PROGRAM}${DN_STATUS_VERSION} step=$0 result=$1 reason=$2"
          ${if} $3 != ""
            StrCpy $6 "$6 $3"
          ${endif}
          FileWriteUTF16LE $4 "$6$\r$\n"
          FileClose $4
        ${endif}
      ${endif}
    ${endif}
    ClearErrors
    ${if} $8 == "1"
      SetErrors
    ${endif}
    Pop $9
    Pop $8
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $0
    Pop $3
    Pop $2
    Pop $1
  FunctionEnd

  !macro dnStatus STEP RESULT REASON DIRS
    Push "${STEP}"
    Push "${RESULT}"
    Push "${REASON}"
    Push "${DIRS}"
    Call ${DN_FN}dnStatus
  !macroend

  ; Push PATH; Call dnCanonical; Pop RESULT: absolute, long-name form without a
  ; trailing separator ("" when the path is not valid). Links are not resolved.
  ; A path that does not exist yet gets its longest existing ancestor expanded
  ; (so C:\Users\RUNNER~1\...\New matches C:\Users\runneradmin\...\New).
  Function ${DN_FN}dnCanonical
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    StrCpy $1 ""
    ${if} $0 != ""
      System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r2'
      ${if} $2 = 0
      ${orIf} $2 >= ${NSIS_MAX_STRLEN}
        StrCpy $1 ""
      ${else}
        ${do}
          StrCpy $2 $1 1 -1
          ${if} $2 != "\"
            ${break}
          ${endif}
          StrLen $2 $1
          ${if} $2 <= 3
            ${break}
          ${endif}
          StrCpy $1 $1 -1
        ${loop}
        ; $4: the part that exists, $3: the rest (each component with a leading "\").
        StrCpy $3 ""
        StrCpy $4 $1
        ${do}
          System::Call 'kernel32::GetLongPathNameW(w r4, w .r0, i ${NSIS_MAX_STRLEN}) i.r2'
          ${if} $2 <> 0
          ${andIf} $2 < ${NSIS_MAX_STRLEN}
            StrCpy $1 "$0$3"
            ${break}
          ${endif}
          ${GetParent} $4 $0
          StrLen $2 $0
          ; Stop above a drive root: "C:" alone would mean the current directory.
          ${if} $2 <= 2
            ${break}
          ${endif}
          ${GetFileName} $4 $2
          StrCpy $3 "\$2$3"
          StrCpy $4 $0
        ${loop}
      ${endif}
    ${endif}
    StrCpy $0 $1
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push PATH; Call dnAttributes; Pop ATTRIBUTES (-1 when missing).
  Function ${DN_FN}dnAttributes
    Exch $0
    System::Call 'kernel32::GetFileAttributesW(w r0) i.r0'
    Exch $0
  FunctionEnd

  ; Push PATH; Call dnFinalPath; Pop FINAL: the path with every junction and
  ; symbolic link resolved, as Windows itself opens it ("" when it cannot be opened).
  Function ${DN_FN}dnFinalPath
    Exch $0
    Push $1
    Push $2
    ; FILE_SHARE_READ|WRITE|DELETE, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS (folders).
    System::Call 'kernel32::CreateFileW(w r0, i 0, i 7, p 0, i 3, i 0x02000000, p 0) p.r1'
    StrCpy $0 ""
    ${if} $1 <> -1
    ${andIf} $1 <> 0
      System::Call 'kernel32::GetFinalPathNameByHandleW(p r1, w .r0, i ${NSIS_MAX_STRLEN}, i 0) i.r2'
      ${if} $2 = 0
      ${orIf} $2 >= ${NSIS_MAX_STRLEN}
        StrCpy $0 ""
      ${endif}
      System::Call 'kernel32::CloseHandle(p r1)'
    ${endif}
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push PATH; Call dnResolved; Pop RESOLVED: where PATH really is, every
  ; junction and symbolic link resolved: its deepest existing folder (PATH itself
  ; when it exists) named by handle (dnFinalPath), with the components that do not
  ; exist yet appended. "" when a part that exists cannot be opened, so a caller
  ; never compares an unresolved path.
  Function ${DN_FN}dnResolved
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $0
    Call ${DN_FN}dnCanonical
    Pop $0
    ; $1: the part that does not exist yet, each component with a leading "\".
    StrCpy $1 ""
    StrCpy $3 ""
    ${do}
      ${if} $0 == ""
        ${break}
      ${endif}
      Push $0
      Call ${DN_FN}dnAttributes
      Pop $2
      ${if} $2 <> -1
        Push $0
        Call ${DN_FN}dnFinalPath
        Pop $2
        ${if} $2 != ""
          ; A drive root comes back as "\\?\C:\".
          StrCpy $3 $2 1 -1
          ${if} $3 == "\"
            StrCpy $2 $2 -1
          ${endif}
          StrCpy $3 "$2$1"
        ${endif}
        ${break}
      ${endif}
      ${GetFileName} $0 $2
      StrCpy $1 "\$2$1"
      ${GetParent} $0 $0
      StrLen $2 $0
      ${if} $2 < 2
        StrCpy $0 ""
      ${endif}
    ${loop}
    StrCpy $0 $3
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push HANDLE; Call dnHandleAttributes; Pop ATTRIBUTES of the object HANDLE
  ; refers to (FileAttributeTagInfo), -1 when they cannot be read.
  Function ${DN_FN}dnHandleAttributes
    Exch $0
    Push $1
    Push $2
    System::Alloc 8
    Pop $1
    System::Call 'kernel32::GetFileInformationByHandleEx(p r0, i 9, p r1, i 8) i.r2'
    ${if} $2 = 0
      StrCpy $0 -1
    ${else}
      System::Call '*$1(i .r0)'
    ${endif}
    System::Free $1
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push HANDLE; Call dnHandleIdentity; Pop "<volume serial>:<file index>" of the
  ; object HANDLE refers to, "" when it cannot be read.
  Function ${DN_FN}dnHandleIdentity
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    System::Alloc 52
    Pop $1
    System::Call 'kernel32::GetFileInformationByHandle(p r0, p r1) i.r2'
    ${if} $2 = 0
      StrCpy $0 ""
    ${else}
      ; BY_HANDLE_FILE_INFORMATION: dwVolumeSerialNumber, nFileIndexHigh, nFileIndexLow.
      System::Call '*$1(i, i, i, i, i, i, i, i .r2, i, i, i, i .r3, i .r4)'
      StrCpy $0 "$2:$3:$4"
    ${endif}
    System::Free $1
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push HANDLE; Call dnHandlePath; Pop the full path of the object HANDLE refers
  ; to, as Windows names it (GetFinalPathNameByHandle), "" when it cannot be read.
  Function ${DN_FN}dnHandlePath
    Exch $0
    Push $1
    Push $2
    System::Call 'kernel32::GetFinalPathNameByHandleW(p r0, w .r1, i ${NSIS_MAX_STRLEN}, i 0) i.r2'
    ${if} $2 = 0
    ${orIf} $2 >= ${NSIS_MAX_STRLEN}
      StrCpy $1 ""
    ${endif}
    StrCpy $0 $1
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push PATH; Push ACCESS; Push SHARE; Call dnOpenNoFollow; Pop HANDLE (0 when it
  ; cannot be opened). Opens PATH itself, never what a junction or symbolic link
  ; there points to (FILE_FLAG_OPEN_REPARSE_POINT); folders too (BACKUP_SEMANTICS).
  Function ${DN_FN}dnOpenNoFollow
    Exch $2
    Exch
    Exch $1
    Exch 2
    Exch $0
    Push $3
    System::Call 'kernel32::CreateFileW(w r0, i r1, i r2, p 0, i 3, i ${DN_OPEN_NO_FOLLOW}, p 0) p.r3'
    ${if} $3 = -1
      StrCpy $3 0
    ${endif}
    StrCpy $0 $3
    Pop $3
    Exch $0
    Exch 2
    Pop $1
    Pop $2
  FunctionEnd

  ; Push HANDLE; Call dnDeleteHandle; Pop 1 when the object HANDLE refers to (opened
  ; with DELETE access) is marked for deletion, else 0. For a junction or link
  ; opened with dnOpenNoFollow that is the link itself, never its target.
  Function ${DN_FN}dnDeleteHandle
    Exch $0
    Push $1
    ; FileDispositionInfoEx: FILE_DISPOSITION_FLAG_DELETE | IGNORE_READONLY_ATTRIBUTE.
    System::Call 'kernel32::SetFileInformationByHandle(p r0, i 21, *i 0x11, i 4) i.r1'
    ${if} $1 = 0
      ; Before Windows 10 1809: FileDispositionInfo.
      System::Call 'kernel32::SetFileInformationByHandle(p r0, i 4, *i 1, i 4) i.r1'
    ${endif}
    ${if} $1 = 0
      StrCpy $0 0
    ${else}
      StrCpy $0 1
    ${endif}
    Pop $1
    Exch $0
  FunctionEnd

  ; Push A; Push B; Call dnOverlaps; Pop 1 when A and B are the same folder or
  ; one is inside the other (case-insensitive, separator-bounded), else 0.
  Function ${DN_FN}dnOverlaps
    Exch $1
    Exch
    Exch $0
    Push $2
    Push $3
    StrCpy $3 "0"
    ${if} $0 == $1
      StrCpy $3 "1"
    ${else}
      StrLen $2 "$1\"
      StrCpy $2 $0 $2
      ${if} $2 == "$1\"
        StrCpy $3 "1"
      ${endif}
      StrLen $2 "$0\"
      StrCpy $2 $1 $2
      ${if} $2 == "$0\"
        StrCpy $3 "1"
      ${endif}
    ${endif}
    StrCpy $0 $3
    Pop $3
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Push LEGACY; Push NEW; Call dnCheckLegacyDir; Pop REASON: "" when LEGACY is the
  ; old install that may be removed once NEW holds the new one, else why not.
  ; LEGACY must be exactly <$dnProgramsRoot>\APP_FILENAME after normalising case,
  ; separators, "." / ".." and short names, a real folder (no junction, symbolic
  ; link or mount point) that holds DN_APP_EXE, and must resolve to
  ; that same place; NEW must be the sibling PRODUCT_FILENAME and, if it exists, a
  ; real folder that does not resolve onto or into LEGACY (or the reverse); and
  ; neither may overlap the app profile, compared both as written and resolved
  ; (dnResolved: junctions and links followed), equal or inside one another
  ; either way.
  Function ${DN_FN}dnCheckLegacyDir
    Exch $1
    Exch
    Exch $0
    Push $2
    Push $3
    Push $4
    Push $5
    StrCpy $5 ""
    StrCpy $dnWhy ""
    Push $0
    Call ${DN_FN}dnCanonical
    Pop $0
    Push $1
    Call ${DN_FN}dnCanonical
    Pop $1
    Push $dnProgramsRoot
    Call ${DN_FN}dnCanonical
    Pop $2
    ${if} $0 == ""
    ${orIf} $1 == ""
    ${orIf} $2 == ""
      !insertmacro dnFail $5 path-invalid "a path is not valid"
    ${elseif} $0 != "$2\${APP_FILENAME}"
      !insertmacro dnFail $5 legacy-not-default "the old folder is not $2\${APP_FILENAME}"
    ${elseif} $1 != "$2\${PRODUCT_FILENAME}"
      !insertmacro dnFail $5 dest-not-sibling "the new folder is not $2\${PRODUCT_FILENAME}"
    ${endif}
    ${if} $5 == ""
      Push $0
      Push $1
      Call ${DN_FN}dnOverlaps
      Pop $3
      ${if} $3 == "1"
        !insertmacro dnFail $5 dirs-overlap "the old and new folders overlap"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $dnProfileDir
      Call ${DN_FN}dnCanonical
      Pop $3
      ${if} $3 == ""
        !insertmacro dnFail $5 profile-invalid "the profile path is not valid"
      ${else}
        Push $0
        Push $3
        Call ${DN_FN}dnOverlaps
        Pop $4
        Push $1
        Push $3
        Call ${DN_FN}dnOverlaps
        Pop $3
        ${if} $4 == "1"
        ${orIf} $3 == "1"
          !insertmacro dnFail $5 profile-overlap "a folder overlaps the app profile"
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $0
      Call ${DN_FN}dnAttributes
      Pop $3
      IntOp $4 $3 & ${DN_ATTR_REPARSE_POINT}
      ${if} $3 = -1
        !insertmacro dnFail $5 legacy-missing "the old folder does not exist"
      ${elseif} $4 <> 0
        !insertmacro dnFail $5 legacy-link "the old folder is a junction or link"
      ${else}
        IntOp $4 $3 & ${DN_ATTR_DIRECTORY}
        ${if} $4 = 0
          !insertmacro dnFail $5 legacy-not-folder "the old folder is not a folder"
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push "$0\${DN_APP_EXE}"
      Call ${DN_FN}dnAttributes
      Pop $3
      IntOp $4 $3 & 0x410
      ${if} $3 = -1
      ${orIf} $4 <> 0
        !insertmacro dnFail $5 legacy-no-exe "the old folder has no ${DN_APP_EXE}"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $1
      Call ${DN_FN}dnAttributes
      Pop $3
      ${if} $3 <> -1
        IntOp $4 $3 & 0x410
        ${if} $4 <> ${DN_ATTR_DIRECTORY}
          !insertmacro dnFail $5 dest-link "the new folder is a junction, link or file"
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 == ""
      ; Where Windows really opens them, whatever links lie above.
      Push $2
      Call ${DN_FN}dnFinalPath
      Pop $2
      Push $0
      Call ${DN_FN}dnFinalPath
      Pop $3
      ${if} $2 == ""
      ${orIf} $3 == ""
        !insertmacro dnFail $5 open-failed "a folder cannot be opened"
      ${elseif} $3 != "$2\${APP_FILENAME}"
        !insertmacro dnFail $5 legacy-resolves-elsewhere "the old folder resolves to $3"
      ${else}
        Push $1
        Call ${DN_FN}dnAttributes
        Pop $4
        ${if} $4 <> -1
          Push $1
          Call ${DN_FN}dnFinalPath
          Pop $4
          ${if} $4 == ""
            !insertmacro dnFail $5 dest-open-failed "the new folder cannot be opened"
          ${else}
            Push $3
            Push $4
            Call ${DN_FN}dnOverlaps
            Pop $4
            ${if} $4 == "1"
              !insertmacro dnFail $5 dirs-same "the old and new folders resolve to the same place"
            ${endif}
          ${endif}
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 == ""
      ; The overlap checks again on where the folders and the profile really are,
      ; every junction and link resolved (a missing folder by its deepest existing
      ; parent): the profile itself or a folder above it may be a junction into the
      ; old install, or the reverse.
      Push $0
      Call ${DN_FN}dnResolved
      Pop $3
      Push $1
      Call ${DN_FN}dnResolved
      Pop $4
      Push $dnProfileDir
      Call ${DN_FN}dnResolved
      Pop $2
      ${if} $3 == ""
      ${orIf} $4 == ""
      ${orIf} $2 == ""
        !insertmacro dnFail $5 resolve-failed "a folder or the app profile cannot be resolved"
      ${else}
        Push $3
        Push $2
        Call ${DN_FN}dnOverlaps
        Pop $2
        ${if} $2 == "1"
          !insertmacro dnFail $5 profile-overlap-resolved "the old folder really overlaps the app profile"
        ${else}
          Push $dnProfileDir
          Call ${DN_FN}dnResolved
          Pop $2
          Push $4
          Push $2
          Call ${DN_FN}dnOverlaps
          Pop $2
          ${if} $2 == "1"
            !insertmacro dnFail $5 profile-overlap-resolved "the new folder really overlaps the app profile"
          ${else}
            Push $3
            Push $4
            Call ${DN_FN}dnOverlaps
            Pop $2
            ${if} $2 == "1"
              !insertmacro dnFail $5 dirs-same "the old and new folders resolve to the same place"
            ${endif}
          ${endif}
        ${endif}
      ${endif}
    ${endif}
    StrCpy $0 $5
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Push DIR; Push PIN; Push SKIP; Call dnRemoveTreeAt; Pop STATUS. Empties DIR,
  ; which PIN holds open (dnOpenNoFollow with DELETE, no FILE_SHARE_DELETE, so no
  ; other process can rename, move or replace it meanwhile), except an entry named
  ; SKIP. Everything is verified and deleted by handle, so a folder swapped for a
  ; junction between a check and its use cannot lead outside:
  ;   - before DIR is listed, the path DIR must still open as PIN's own object
  ;     (same volume serial and file index) and not as a link;
  ;   - each entry is opened without following links and must be DIR's own
  ;     entry: its final path is PIN's final path plus "\<name>";
  ;   - a file, junction or symbolic link is deleted through that handle (a link
  ;     itself, never its target); a real folder is held open the same way, emptied
  ;     the same way, then deleted through its handle.
  ;   - no folder it empties may be the app profile or the new install
  ;     ($dnProtectProfile / $dnProtectDest, set by dnPinLegacy).
  ; STATUS: "ok" (all gone), "kept" (something could not be deleted, e.g. held
  ; open, and stays) or "unsafe" (an identity check failed: removal stopped at
  ; once; nothing that failed a check was touched).
  Function ${DN_FN}dnRemoveTreeAt
    Exch $2
    Exch
    Exch $1
    Exch 2
    Exch $0
    Push $3
    Push $4
    Push $5
    Push $6
    Push $7
    Push $8
    Push $9
    StrCpy $8 "ok"
    ; FILE_READ_ATTRIBUTES, every share mode: a check only.
    Push $0
    Push 0x80
    Push 7
    Call ${DN_FN}dnOpenNoFollow
    Pop $5
    ${if} $5 = 0
      StrCpy $8 "unsafe"
    ${else}
      Push $5
      Call ${DN_FN}dnHandleIdentity
      Pop $6
      Push $5
      Call ${DN_FN}dnHandleAttributes
      Pop $7
      System::Call 'kernel32::CloseHandle(p r5)'
      Push $1
      Call ${DN_FN}dnHandleIdentity
      Pop $9
      IntOp $7 $7 & ${DN_ATTR_REPARSE_POINT}
      ${if} $6 == ""
      ${orIf} $6 != $9
      ${orIf} $7 <> 0
        StrCpy $8 "unsafe"
      ${endif}
      ; Never the app profile or the new install, however it was reached.
      ${if} $6 == $dnProtectProfile
      ${orIf} $6 == $dnProtectDest
        StrCpy $8 "unsafe"
      ${endif}
    ${endif}
    ${if} $8 == "ok"
      ClearErrors
      FindFirst $3 $4 "$0\*.*"
      ${doWhile} $4 != ""
        ${if} $4 != "."
        ${andIf} $4 != ".."
        ${andIf} $4 != $2
          Push "$0\$4"
          Push ${DN_ACCESS_DELETE}
          Push 3
          Call ${DN_FN}dnOpenNoFollow
          Pop $5
          ${if} $5 = 0
            ; Held open by another program (or not ours to delete): it stays.
            StrCpy $8 "kept"
          ${else}
            Push $1
            Call ${DN_FN}dnHandlePath
            Pop $9
            Push $5
            Call ${DN_FN}dnHandlePath
            Pop $6
            Push $5
            Call ${DN_FN}dnHandleAttributes
            Pop $7
            ${if} $9 == ""
            ${orIf} $6 != "$9\$4"
            ${orIf} $7 = -1
              StrCpy $8 "unsafe"
            ${else}
              IntOp $6 $7 & ${DN_ATTR_REPARSE_POINT}
              IntOp $7 $7 & ${DN_ATTR_DIRECTORY}
              ${if} $6 = 0
              ${andIf} $7 <> 0
                Push "$0\$4"
                Push $5
                Push ""
                Call ${DN_FN}dnRemoveTreeAt
                Pop $6
                ${if} $6 == "unsafe"
                  StrCpy $8 "unsafe"
                ${elseif} $6 == "kept"
                  StrCpy $8 "kept"
                ${else}
                  Push $5
                  Call ${DN_FN}dnDeleteHandle
                  Pop $6
                  ${if} $6 = 0
                    StrCpy $8 "kept"
                  ${endif}
                ${endif}
              ${else}
                Push $5
                Call ${DN_FN}dnDeleteHandle
                Pop $6
                ${if} $6 = 0
                  StrCpy $8 "kept"
                ${endif}
              ${endif}
            ${endif}
            System::Call 'kernel32::CloseHandle(p r5)'
          ${endif}
        ${endif}
        ${if} $8 == "unsafe"
          ${break}
        ${endif}
        ClearErrors
        FindNext $3 $4
      ${loop}
      FindClose $3
    ${endif}
    StrCpy $0 $8
    Pop $9
    Pop $8
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Exch $0
    Exch 2
    Pop $1
    Pop $2
  FunctionEnd

  ; Push PATH; Call dnOpenFollow; Pop HANDLE (0 when PATH does not exist or cannot
  ; be opened): what Windows opens at PATH, links followed, held only to read its
  ; identity and final path (FILE_READ_ATTRIBUTES, every share mode).
  Function ${DN_FN}dnOpenFollow
    Exch $0
    Push $1
    System::Call 'kernel32::CreateFileW(w r0, i 0x80, i 7, p 0, i 3, i 0x02000000, p 0) p.r1'
    ${if} $1 = -1
      StrCpy $1 0
    ${endif}
    StrCpy $0 $1
    Pop $1
    Exch $0
  FunctionEnd

  ; Call dnUnpin: closes every handle dnPinLegacy holds.
  Function ${DN_FN}dnUnpin
    ${if} $dnPinRoot <> 0
      System::Call 'kernel32::CloseHandle(p $dnPinRoot)'
    ${endif}
    ${if} $dnPinParent <> 0
      System::Call 'kernel32::CloseHandle(p $dnPinParent)'
    ${endif}
    ${if} $dnPinProfile <> 0
      System::Call 'kernel32::CloseHandle(p $dnPinProfile)'
    ${endif}
    ${if} $dnPinDest <> 0
      System::Call 'kernel32::CloseHandle(p $dnPinDest)'
    ${endif}
    StrCpy $dnPinRoot 0
    StrCpy $dnPinParent 0
    StrCpy $dnPinProfile 0
    StrCpy $dnPinDest 0
    StrCpy $dnProtectProfile ""
    StrCpy $dnProtectDest ""
  FunctionEnd

  ; Push PIN; Push PATH; Call dnWhereIs; Pop WHERE: PIN's final path when PIN is
  ; open, else where PATH would be (dnResolved: it does not exist); "" when it
  ; cannot be read.
  Function ${DN_FN}dnWhereIs
    Exch $1
    Exch
    Exch $0
    ${if} $0 <> 0
      Push $0
      Call ${DN_FN}dnHandlePath
      Pop $0
    ${else}
      Push $1
      Call ${DN_FN}dnResolved
      Pop $0
    ${endif}
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Push LEGACY; Push NEW; Call dnPinLegacy; Pop REASON: "" when LEGACY may be
  ; removed now, else why not. Before anything is checked it pins LEGACY itself
  ; ($dnPinRoot: never what a link there points to, DELETE access, no
  ; FILE_SHARE_DELETE, so it cannot be renamed, moved or replaced) and, as they are
  ; now with links followed, $dnProgramsRoot, the profile and NEW. Then: every
  ; dnCheckLegacyDir check by path, and the same facts again on the pinned handles
  ; themselves: the pinned folder is a real folder, its final path is the pinned
  ; parent's final path plus APP_FILENAME, it holds DN_APP_EXE (opened through that
  ; final path), and it neither overlaps nor is the profile or NEW (final paths and
  ; volume serial + file index of the same handles; a missing one by dnResolved).
  ; On success the pins stay for dnRemoveLegacyDir, which deletes only through
  ; $dnPinRoot, and the profile and NEW become identities the deleter never enters;
  ; the caller ends with dnUnpin. On failure everything is unpinned. A test build
  ; (DN_TEST_PAUSE) waits here, between the checks and the removal, for a second
  ; process to change the folders.
  Function ${DN_FN}dnPinLegacy
    Exch $1
    Exch
    Exch $0
    Push $2
    Push $3
    Push $4
    Push $5
    Push $6
    Call ${DN_FN}dnUnpin
    StrCpy $5 ""
    StrCpy $dnWhy ""
    Push $0
    Call ${DN_FN}dnCanonical
    Pop $2
    ${if} $2 == ""
      !insertmacro dnFail $5 path-invalid "a path is not valid"
    ${else}
      Push $2
      Push ${DN_ACCESS_DELETE}
      Push 3
      Call ${DN_FN}dnOpenNoFollow
      Pop $dnPinRoot
      Push $dnProgramsRoot
      Call ${DN_FN}dnOpenFollow
      Pop $dnPinParent
      Push $dnProfileDir
      Call ${DN_FN}dnOpenFollow
      Pop $dnPinProfile
      Push $1
      Call ${DN_FN}dnOpenFollow
      Pop $dnPinDest
      ; Every check by path, as when the migration was planned.
      Push $0
      Push $1
      Call ${DN_FN}dnCheckLegacyDir
      Pop $5
      ${if} $5 == ""
      ${andIf} $dnPinRoot = 0
        !insertmacro dnFail $5 pin-open-failed "the old folder cannot be opened"
      ${elseif} $5 == ""
      ${andIf} $dnPinParent = 0
        !insertmacro dnFail $5 pin-open-failed "the old folder cannot be opened"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $dnPinRoot
      Call ${DN_FN}dnHandleAttributes
      Pop $3
      IntOp $4 $3 & 0x410
      ${if} $3 = -1
      ${orIf} $4 <> ${DN_ATTR_DIRECTORY}
        !insertmacro dnFail $5 pin-not-folder "the pinned old folder is not a real folder"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $dnPinRoot
      Call ${DN_FN}dnHandlePath
      Pop $2
      Push $dnPinParent
      Call ${DN_FN}dnHandlePath
      Pop $3
      ; A drive root comes back as "\\?\C:\".
      StrCpy $4 $3 1 -1
      ${if} $4 == "\"
        StrCpy $3 $3 -1
      ${endif}
      ${if} $2 == ""
      ${orIf} $3 == ""
        !insertmacro dnFail $5 pin-read-failed "a pinned folder cannot be read"
      ${elseif} $2 != "$3\${APP_FILENAME}"
        !insertmacro dnFail $5 pin-moved "the pinned old folder is $2, not in $3"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push "$2\${DN_APP_EXE}"
      Push 0x80
      Push 7
      Call ${DN_FN}dnOpenNoFollow
      Pop $4
      ${if} $4 = 0
        !insertmacro dnFail $5 pin-no-exe "the pinned old folder has no ${DN_APP_EXE}"
      ${else}
        Push $4
        Call ${DN_FN}dnHandleAttributes
        Pop $3
        Push $4
        Call ${DN_FN}dnHandlePath
        Pop $6
        System::Call 'kernel32::CloseHandle(p r4)'
        IntOp $4 $3 & 0x410
        ${if} $3 = -1
        ${orIf} $4 <> 0
        ${orIf} $6 != "$2\${DN_APP_EXE}"
          !insertmacro dnFail $5 pin-no-exe "the pinned old folder has no ${DN_APP_EXE}"
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $dnPinRoot
      Call ${DN_FN}dnHandleIdentity
      Pop $6
      Push $dnPinProfile
      Push $dnProfileDir
      Call ${DN_FN}dnWhereIs
      Pop $3
      ${if} $6 == ""
      ${orIf} $3 == ""
        !insertmacro dnFail $5 pin-read-failed "a pinned folder or the app profile cannot be read"
      ${else}
        Push $2
        Push $3
        Call ${DN_FN}dnOverlaps
        Pop $4
        ${if} $dnPinProfile <> 0
          Push $dnPinProfile
          Call ${DN_FN}dnHandleIdentity
          Pop $dnProtectProfile
          ${if} $dnProtectProfile == $6
          ${orIf} $dnProtectProfile == ""
            StrCpy $4 "1"
          ${endif}
        ${endif}
        ${if} $4 == "1"
          !insertmacro dnFail $5 pin-profile-overlap "the pinned old folder overlaps the app profile"
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $dnPinDest
      Push $1
      Call ${DN_FN}dnWhereIs
      Pop $3
      ${if} $3 == ""
        !insertmacro dnFail $5 pin-dest-read-failed "the new folder cannot be read"
      ${else}
        Push $2
        Push $3
        Call ${DN_FN}dnOverlaps
        Pop $4
        ${if} $dnPinDest <> 0
          Push $dnPinDest
          Call ${DN_FN}dnHandleIdentity
          Pop $dnProtectDest
          ${if} $dnProtectDest == $6
          ${orIf} $dnProtectDest == ""
            StrCpy $4 "1"
          ${endif}
        ${endif}
        ${if} $4 == "1"
          !insertmacro dnFail $5 pin-dest-overlap "the pinned old folder overlaps the new folder"
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 != ""
      Call ${DN_FN}dnUnpin
    ${endif}
    !ifdef DN_TEST_PAUSE
      ; Test builds only: signal <pause>.ready, wait (up to 60 s) for <pause>.go.
      ${if} $5 == ""
        FileOpen $3 "${DN_TEST_PAUSE}.ready" w
        FileClose $3
        StrCpy $3 0
        ${do}
          ${if} ${FileExists} "${DN_TEST_PAUSE}.go"
          ${orIf} $3 >= 1200
            ${break}
          ${endif}
          Sleep 50
          IntOp $3 $3 + 1
        ${loop}
      ${endif}
    !endif
    StrCpy $0 $5
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Push DIR; Call dnRemoveLegacyDir; Pop "removed", "kept" or "unsafe". Removes
  ; the folder $dnPinRoot holds (dnPinLegacy, or a test that pins DIR itself) and
  ; never opens DIR by path to find it: DIR must still open as that very folder
  ; (dnRemoveTreeAt checks before every listing), and everything is verified and
  ; deleted through handles. Everything but DN_APP_EXE goes first and the exe last,
  ; so a folder that is only partly removed (a file was held) still holds the exe
  ; and the next run's dnCheckLegacyDir still recognises it as the old install.
  ; "unsafe": an identity check failed and removal stopped; what is left stays for
  ; the next run. The root pin is closed (and so a deleted folder really goes).
  Function ${DN_FN}dnRemoveLegacyDir
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    StrCpy $3 "kept"
    StrCpy $1 $dnPinRoot
    ${if} $1 = 0
      StrCpy $3 "unsafe"
    ${else}
      Push $1
      Call ${DN_FN}dnHandleAttributes
      Pop $2
      IntOp $4 $2 & 0x410
      ${if} $2 = -1
      ${orIf} $4 <> ${DN_ATTR_DIRECTORY}
        StrCpy $3 "unsafe"
      ${endif}
      ${if} $3 != "unsafe"
        Push $0
        Push $1
        Push "${DN_APP_EXE}"
        Call ${DN_FN}dnRemoveTreeAt
        Pop $2
        ${if} $2 == "ok"
          ; Only the exe is left: delete it last, then the folder.
          Push $0
          Push $1
          Push ""
          Call ${DN_FN}dnRemoveTreeAt
          Pop $2
          ${if} $2 == "ok"
            Push $1
            Call ${DN_FN}dnDeleteHandle
            Pop $4
          ${endif}
        ${endif}
        ${if} $2 == "unsafe"
          StrCpy $3 "unsafe"
        ${endif}
      ${endif}
      System::Call 'kernel32::CloseHandle(p r1)'
      StrCpy $dnPinRoot 0
    ${endif}
    ${if} $3 != "unsafe"
      ${if} ${FileExists} "$0\*.*"
        StrCpy $3 "kept"
      ${else}
        StrCpy $3 "removed"
      ${endif}
    ${endif}
    StrCpy $0 $3
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push DEST; Call dnTrustedJournal; Pop SOURCE: the old folder an earlier,
  ; unfinished run recorded in the journal at $dnJournalKey, or "" when there is
  ; none or it is not trusted: it must name this identity and DEST, and its
  ; source must still pass dnCheckLegacyDir. $dnPlanNote says why not.
  Function ${DN_FN}dnTrustedJournal
    Exch $0
    Push $1
    Push $2
    Push $3
    StrCpy $dnPlanNote ""
    ReadRegStr $1 HKCU $dnJournalKey "Identity"
    ReadRegStr $2 HKCU $dnJournalKey "SourceDir"
    ReadRegStr $3 HKCU $dnJournalKey "DestDir"
    ${if} $1 == ""
      StrCpy $0 ""
    ${elseif} $1 != "${DN_MIGRATION_IDENTITY}"
      StrCpy $dnPlanNote "the migration journal is for another app"
      StrCpy $dnWhy "journal-foreign"
      StrCpy $0 ""
    ${elseif} $2 == ""
    ${orIf} $3 == ""
      ; Complete = Identity, SourceDir and DestDir (Identity is written last).
      StrCpy $dnPlanNote "the migration journal is incomplete"
      StrCpy $dnWhy "journal-incomplete"
      StrCpy $0 ""
    ${else}
      Push $0
      Call ${DN_FN}dnCanonical
      Pop $0
      Push $3
      Call ${DN_FN}dnCanonical
      Pop $3
      ${if} $3 != $0
        StrCpy $dnPlanNote "the migration journal is for $3"
        StrCpy $dnWhy "journal-other-dest"
        StrCpy $0 ""
      ${else}
        Push $2
        Push $0
        Call ${DN_FN}dnCheckLegacyDir
        Pop $1
        ${if} $1 != ""
          StrCpy $dnPlanNote "the migration journal for $2: $1"
          StrCpy $dnWhy "journal-$dnWhy"
          StrCpy $0 ""
        ${else}
          Push $2
          Call ${DN_FN}dnCanonical
          Pop $0
        ${endif}
      ${endif}
    ${endif}
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd
!endif

!ifdef DN_WITH_UNINSTALL_LEGACY
  ; This identity's "Open at login" entry, as Electron writes it: the value
  ; $dnLoginItem (the appId) under HKCU\$dnRunKey, and its Task Manager state under
  ; HKCU\$dnStartupKey. The uninstaller and the harness set them.
  Var dnRunKey
  Var dnStartupKey
  Var dnLoginItem

  ; Push LEGACY; Push DEST; Call dnDropLoginItem; Pop RESULT. When a user uninstall
  ; has to leave LEGACY behind (its app would not close, a file was held), this
  ; identity's login entry would keep starting that stale copy at every sign-in,
  ; with no Apps & features entry left to remove it. If the entry starts exactly
  ; LEGACY's or DEST's DN_APP_EXE (the quoted path Electron writes, compared
  ; normalised, then nothing or arguments), it is deleted with its Task Manager
  ; state: "removed". "absent": there is none. "kept": it starts something else,
  ; which is not ours to change.
  Function ${DN_FN}dnDropLoginItem
    Exch $1
    Exch
    Exch $0
    Push $2
    Push $3
    Push $4
    Push $5
    StrCpy $5 "absent"
    ReadRegStr $2 HKCU $dnRunKey $dnLoginItem
    ${if} $2 != ""
      StrCpy $5 "kept"
      StrCpy $3 $2 1
      ${if} $3 == '"'
        StrCpy $4 1
        ${do}
          StrCpy $3 $2 1 $4
          ${if} $3 == '"'
          ${orIf} $3 == ""
            ${break}
          ${endif}
          IntOp $4 $4 + 1
        ${loop}
        ${if} $3 == '"'
          ; $4: the closing quote. Then the end, or a space and arguments.
          IntOp $3 $4 + 1
          StrCpy $3 $2 1 $3
          ${if} $3 == ""
          ${orIf} $3 == " "
            IntOp $3 $4 - 1
            StrCpy $3 $2 $3 1
            Push $3
            Call ${DN_FN}dnCanonical
            Pop $3
            ${if} $3 != ""
              Push "$0\${DN_APP_EXE}"
              Call ${DN_FN}dnCanonical
              Pop $4
              ${if} $3 == $4
                StrCpy $5 "removed"
              ${else}
                Push "$1\${DN_APP_EXE}"
                Call ${DN_FN}dnCanonical
                Pop $4
                ${if} $3 == $4
                  StrCpy $5 "removed"
                ${endif}
              ${endif}
            ${endif}
          ${endif}
        ${endif}
      ${endif}
      ${if} $5 == "removed"
        DeleteRegValue HKCU $dnRunKey $dnLoginItem
        DeleteRegValue HKCU $dnStartupKey $dnLoginItem
        ReadRegStr $2 HKCU $dnRunKey $dnLoginItem
        ${if} $2 != ""
          StrCpy $5 "kept"
        ${endif}
      ${endif}
    ${endif}
    StrCpy $0 $5
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Push DEST; Call dnUninstallLegacy; Pop RESULT. A user uninstall (not --updated)
  ; of the copy in DEST while a move into DEST is unfinished (a trusted journal,
  ; dnTrustedJournal) also removes the old folder that move left behind, after the
  ; same checks and with the same handle-verified removal, because electron-builder's
  ; uninstaller deletes the journal and nothing would ever finish the move. The app
  ; there is closed only with consent ($dnClosePolicy: the uninstaller asks when the
  ; user started it, closes nothing under /S). RESULT: "none" (no unfinished
  ; move), "removed", or "kept: <why>": the old folder then stays as a stale copy
  ; without an uninstall entry, which the next install of this app finds at the old
  ; default folder and moves away (dnPlanMigration); this identity's login entry is
  ; dropped if it starts that copy (dnDropLoginItem), so it does not start at
  ; every sign-in meanwhile.
  Function ${DN_FN}dnUninstallLegacy
    Exch $0
    Push $1
    Push $2
    Push $3
    StrCpy $3 $0
    Push $0
    Call ${DN_FN}dnTrustedJournal
    Pop $1
    ${if} $1 == ""
      !insertmacro dnStatus uninstall uninstalled no-pending-move "in=$0"
      StrCpy $0 "none"
    ${else}
      !insertmacro dnCloseAppIn "$1" $dnClosePolicy $dnCloseResult
      ${if} $dnCloseResult != "none"
      ${andIf} $dnCloseResult != "closed"
        StrCpy $0 "kept: ${PRODUCT_NAME} there is $dnCloseResult"
        ${if} $dnCloseResult == "unknown"
          StrCpy $dnWhy "unknown-process"
        ${elseif} $dnCloseResult == "cancel"
          StrCpy $dnWhy "user-declined"
        ${else}
          StrCpy $dnWhy "app-running"
        ${endif}
      ${else}
        Push $1
        Push $0
        Call ${DN_FN}dnPinLegacy
        Pop $2
        ${if} $2 != ""
          StrCpy $0 "kept: $2"
        ${else}
          Push $1
          Call ${DN_FN}dnRemoveLegacyDir
          Pop $2
          Call ${DN_FN}dnUnpin
          ${if} $2 == "removed"
            DeleteRegKey HKCU $dnJournalKey
            StrCpy $0 "removed"
          ${elseif} $2 == "unsafe"
            StrCpy $0 "kept: an identity check failed while removing it"
            StrCpy $dnWhy "identity-check"
          ${else}
            StrCpy $0 "kept: a file is still in use"
            StrCpy $dnWhy "file-in-use"
          ${endif}
        ${endif}
      ${endif}
      DetailPrint "$1: $0"
      ${if} $0 == "removed"
        !insertmacro dnStatus uninstall uninstalled-legacy-removed removed "from=$1"
      ${else}
        StrCpy $2 $dnWhy
        Push $1
        Push $3
        Call ${DN_FN}dnDropLoginItem
        Pop $3
        DetailPrint "Login item for $1: $3"
        ${if} $3 == "removed"
          !insertmacro dnStatus login-item login-item-removed run-value-deleted "from=$1"
        ${elseif} $3 == "absent"
          !insertmacro dnStatus login-item login-item-absent no-run-value "from=$1"
        ${else}
          !insertmacro dnStatus login-item login-item-kept not-ours "from=$1"
        ${endif}
        !insertmacro dnStatus uninstall uninstalled-legacy-kept $2 "from=$1"
      ${endif}
    ${endif}
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd
!endif

!ifndef BUILD_UNINSTALLER
  Var dnStateKey
  Var dnPlanDir
  Var dnPlanLegacy
  Var dnUninstallKey
  Var dnUninstallKey2
  Var dnSavedIdentity
  Var dnSavedSource
  Var dnSavedDest
  Var dnSavedUninstall
  Var dnSavedDesktop
  Var dnSavedStartMenu
  Var dnSavedRecord
  Var dnRecoveryKey
  ; The key that holds every identity's recovery key ("": not deleted when empty).
  Var dnRecoveryParent
  ; Why dnMigrationClose kept the old folder (app-running | unknown-process).
  Var dnKeepWhy

  ; Where to install, from the folder electron-builder chose (no /D).
  ; In: $dnPlanDir. Out: $dnPlanDir, the folder to install to; $dnPlanLegacy, the
  ; old install to move from ("" for none); $dnPlanNote, why a folder named
  ; APP_FILENAME is upgraded where it is. Only <$dnProgramsRoot>\APP_FILENAME
  ; itself is ever redirected (compared after normalising case, separators and
  ; short names): a recorded install in any other folder named APP_FILENAME, for
  ; example from an earlier /D=X\desktop, stays where it is and nothing is moved
  ; or deleted.
  Function dnPlanMigration
    Push $0
    Push $1
    Push $2
    Push $3
    StrCpy $dnPlanLegacy ""
    StrCpy $dnPlanNote ""
    StrCpy $dnWhy ""
    Push $dnPlanDir
    Call dnCanonical
    Pop $0
    Push $dnProgramsRoot
    Call dnCanonical
    Pop $1
    ${if} $0 == ""
    ${orIf} $1 == ""
      !insertmacro dnFail $dnPlanNote path-invalid "a path is not valid"
    ${else}
      ${GetFileName} $0 $2
      ${GetParent} $0 $3
      ${if} $2 != "${APP_FILENAME}"
        ; Not the old default folder name: nothing to do.
        StrCpy $dnWhy "no-legacy"
      ${elseif} $3 != $1
        !insertmacro dnFail $dnPlanNote not-default-folder "$0 is not in $1"
      ${elseif} ${FileExists} "$0\${DN_APP_EXE}"
        Push $0
        Push "$1\${PRODUCT_FILENAME}"
        Call dnCheckLegacyDir
        Pop $2
        ${if} $2 == ""
          StrCpy $dnPlanLegacy $0
          StrCpy $dnPlanDir "$1\${PRODUCT_FILENAME}"
          StrCpy $dnWhy "legacy-found"
        ${else}
          ; $dnWhy: dnCheckLegacyDir's code.
          StrCpy $dnPlanNote $2
        ${endif}
      ${else}
        ; A fresh install to the default folder gets the new name.
        StrCpy $dnPlanDir "$1\${PRODUCT_FILENAME}"
        StrCpy $dnWhy "fresh-install"
      ${endif}
    ${endif}
    ${if} $dnPlanLegacy != ""
      !insertmacro dnStatus plan plan-move $dnWhy "from=$dnPlanLegacy to=$dnPlanDir"
    ${else}
      !insertmacro dnStatus plan plan-in-place $dnWhy "to=$dnPlanDir"
    ${endif}
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  ; Push LEGACY; Push NEW; Call dnMigrationClose; Pop KEEP. A pending migration
  ; checks both folders, each on its own, with $dnClosePolicy: the app running
  ; from exactly LEGACY\DN_APP_EXE (a new exe that already exists never
  ; suppresses this), then exactly NEW\DN_APP_EXE, which must not run while its
  ; files are replaced (dnEnsureNotRunning). KEEP is "1" when the old app could
  ; not be closed or identified: the new copy is installed, the old folder and
  ; the journal stay for the next run. A silent run without --updated with the
  ; old app running quits with exit code 2 before anything is closed, parked,
  ; extracted or deleted (customInit's registry repairs may already have run).
  Function dnMigrationClose
    Exch $1
    Exch
    Exch $0
    Push $2
    StrCpy $2 "0"
    StrCpy $dnKeepWhy ""
    !insertmacro dnCloseAppIn "$0" $dnClosePolicy $dnCloseResult
    ${if} $dnCloseResult == "cancel"
      !insertmacro dnStatus close cancelled user-cancelled "from=$0"
      Quit
    ${elseif} $dnCloseResult == "running"
    ${andIf} $dnClosePolicy == "never"
      ; A silent install nobody asked the app for (/S without --updated) closes
      ; nothing, and installing the new copy beside the running old one would leave
      ; that one running, starting at login and holding the single-instance lock
      ; the new exe needs. Quit before anything changed, like an in-place install.
      DetailPrint `"${PRODUCT_NAME}" is running from $0 and a silent install without --updated does not close it; nothing was installed, moved or deleted`
      !insertmacro dnStatus close exit-2 app-running-silent "from=$0"
      SetErrorLevel 2
      Quit
    ${elseif} $dnCloseResult != "none"
    ${andIf} $dnCloseResult != "closed"
      StrCpy $2 "1"
      StrCpy $dnKeepWhy "app-running"
      ${if} $dnCloseResult == "unknown"
        StrCpy $dnKeepWhy "unknown-process"
      ${endif}
      DetailPrint "Keeping $0 until ${PRODUCT_NAME} there can be closed"
      !insertmacro dnStatus close close-keep $dnKeepWhy "from=$0"
    ${else}
      !insertmacro dnStatus close close-ok $dnCloseResult "from=$0"
    ${endif}
    !insertmacro dnEnsureNotRunning "$1"
    StrCpy $0 $2
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Push LEGACY; Push NEW; Push KEEP; Call dnFinishMigration; Pop RESULT, once the
  ; new copy in NEW is verified. Pins LEGACY and checks it again on the pinned
  ; handles right before deleting anything (dnPinLegacy: the folders may have
  ; changed since the run started), then removes exactly the pinned folder by
  ; verified handles (dnRemoveLegacyDir) and clears the journal. RESULT: "removed",
  ; or "kept: <why>" with the journal left armed so the next run retries.
  ;
  ; Only after a real move (the old folder is gone) does it write the record,
  ; MigrationRecord under $dnStateKey (dnWriteRecord). The app repoints its login
  ; item and MCP client entries only when that record names its own folder
  ; (src/main/windows-install-migration.ts), never because of a folder name.
  Function dnFinishMigration
    Exch $2
    Exch
    Exch $1
    Exch 2
    Exch $0
    Push $3
    StrCpy $3 ""
    ${if} $2 != "1"
      Push $0
      Push $1
      Call dnPinLegacy
      Pop $3
    ${endif}
    ${if} $2 == "1"
      StrCpy $3 "kept: ${PRODUCT_NAME} there is still running"
      StrCpy $dnWhy $dnKeepWhy
      ${if} $dnWhy == ""
        StrCpy $dnWhy "app-running"
      ${endif}
    ${elseif} $3 != ""
      ; $dnWhy: dnPinLegacy's code.
      StrCpy $3 "kept: $3"
    ${else}
      Push $0
      Call dnRemoveLegacyDir
      Pop $3
      Call dnUnpin
      ${if} $3 == "removed"
        !insertmacro dnStatus remove moved removed "from=$0 to=$1"
        !insertmacro dnTestStep "finish-removed"
        ; The record first, then the journal: a run that stops in between leaves
        ; the journal armed with its old folder gone, and the next run writes the
        ; record (dnJournalDone / dnCompleteMove). One that cannot write it keeps
        ; the journal for the same reason.
        Push $0
        Push $1
        Call dnWriteRecord
        Pop $2
        ${if} $2 == "written"
          !insertmacro dnTestStep "finish-record"
          DeleteRegKey HKCU $dnJournalKey
        ${endif}
      ${elseif} $3 == "unsafe"
        StrCpy $3 "kept: something in the old folder failed an identity check while it was being removed; removal stopped"
        StrCpy $dnWhy "identity-check"
      ${else}
        StrCpy $3 "kept: a file is still in use"
        StrCpy $dnWhy "file-in-use"
      ${endif}
    ${endif}
    DetailPrint "$0: $3"
    ${if} $3 != "removed"
      !insertmacro dnStatus remove kept $dnWhy "from=$0 to=$1"
    ${endif}
    StrCpy $0 $3
    Pop $3
    Exch $0
    Exch 2
    Pop $1
    Pop $2
  FunctionEnd

  ; Push NAME; Push PATH; Call dnShortcutState; Pop "1" | "0": whether the
  ; shortcut PATH existed when this migration started. The first run records the
  ; answer in the journal ($dnJournalKey, value NAME) before anything changes; a
  ; run that finishes an interrupted migration uses that answer, not what the
  ; interrupted run left behind.
  Function dnShortcutState
    Exch $1
    Exch
    Exch $0
    Push $2
    ReadRegStr $2 HKCU $dnJournalKey $0
    ${if} $2 != "1"
    ${andIf} $2 != "0"
      StrCpy $2 "0"
      ${if} ${FileExists} $1
        StrCpy $2 "1"
      ${endif}
      WriteRegStr HKCU $dnJournalKey $0 $2
    ${endif}
    StrCpy $0 $2
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Push DIR; Push OLD; Push NEW; Call dnRepointPins; Pop COUNT. Repoints every
  ; shortcut (*.lnk) in DIR whose target is exactly OLD (both normalised) to NEW:
  ; its target, and its icon and working folder only where they named OLD and
  ; OLD's folder. Any other shortcut is not opened for writing, no other property
  ; (arguments, description, AppUserModelID) changes, and nothing is created.
  ; IShellLinkW / IPersistFile through the System plugin.
  Function dnRepointPins
    Exch $2
    Exch
    Exch $1
    Exch 2
    Exch $0
    Push $3
    Push $4
    Push $5
    Push $6
    Push $7
    Push $8
    Push $9
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    StrCpy $3 0
    Push $1
    Call dnCanonical
    Pop $R0
    ${GetParent} $R0 $R1
    ${GetParent} $2 $R2
    ClearErrors
    FindFirst $4 $5 "$0\*.lnk"
    ${doWhile} $5 != ""
      StrCpy $R4 "$0\$5"
      StrCpy $6 0
      StrCpy $7 0
      ; CLSID_ShellLink, IID_IShellLinkW, IID_IPersistFile.
      System::Call 'ole32::CoCreateInstance(g "{00021401-0000-0000-C000-000000000046}", p 0, i 1, g "{000214F9-0000-0000-C000-000000000046}", *p .r6) i.r9'
      ${if} $9 = 0
        System::Call '$6->0(g "{0000010B-0000-0000-C000-000000000046}", *p .r7) i.r9'
      ${endif}
      ${if} $9 = 0
        ; IPersistFile::Load(path, STGM_READ)
        System::Call '$7->5(w r14, i 0) i.r9'
      ${endif}
      ${if} $9 = 0
        ; IShellLinkW::GetPath(buffer, size, NULL, 0)
        System::Call '$6->3(w .r8, i ${NSIS_MAX_STRLEN}, p 0, i 0) i.r9'
      ${endif}
      ${if} $9 = 0
      ${andIf} $8 != ""
        Push $8
        Call dnCanonical
        Pop $8
        ${if} $8 == $R0
          ; SetPath(NEW)
          System::Call '$6->20(w r2) i.r9'
          ${if} $9 = 0
            ; GetIconLocation / SetIconLocation, only when the icon was OLD.
            StrCpy $R3 0
            System::Call '$6->16(w .r8, i ${NSIS_MAX_STRLEN}, *i .r13) i.r9'
            ${if} $9 = 0
            ${andIf} $8 != ""
              Push $8
              Call dnCanonical
              Pop $8
              ${if} $8 == $R0
                System::Call '$6->17(w r2, i r13) i.r9'
              ${endif}
            ${endif}
            ; GetWorkingDirectory / SetWorkingDirectory, only when it was OLD's folder.
            System::Call '$6->8(w .r8, i ${NSIS_MAX_STRLEN}) i.r9'
            ${if} $9 = 0
            ${andIf} $8 != ""
              Push $8
              Call dnCanonical
              Pop $8
              ${if} $8 == $R1
                System::Call '$6->9(w r12) i.r9'
              ${endif}
            ${endif}
            ; IPersistFile::Save(path, TRUE)
            System::Call '$7->6(w r14, i 1) i.r9'
            ${if} $9 = 0
              IntOp $3 $3 + 1
              DetailPrint "Repointed $R4"
            ${endif}
          ${endif}
        ${endif}
      ${endif}
      ${if} $7 <> 0
        System::Call '$7->2()'
      ${endif}
      ${if} $6 <> 0
        System::Call '$6->2()'
      ${endif}
      ClearErrors
      FindNext $4 $5
    ${loop}
    FindClose $4
    StrCpy $0 $3
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
    Pop $9
    Pop $8
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Exch $0
    Exch 2
    Pop $1
    Pop $2
  FunctionEnd

  ; Push COMMAND; Call dnUninstallerDir; Pop DIR: the folder whose own uninstaller
  ; COMMAND runs, exactly as electron-builder registers a per-user install
  ; ("<DIR>\DN_UNINSTALLER_EXE" /currentuser, nothing else), the exe path normalised
  ; with dnCanonical before its name is compared (an install registered through
  ; short names, C:\Users\LONGUS~1\...\UNINST~1.EXE, is recognised while the file
  ; exists; a short name for a file that is gone cannot be expanded and is refused);
  ; "" when COMMAND is anything else.
  Function dnUninstallerDir
    Exch $0
    Push $1
    Push $2
    Push $3
    StrCpy $3 ""
    StrCpy $1 $0 1
    ${if} $1 == '"'
      StrCpy $2 1
      ${do}
        StrCpy $1 $0 1 $2
        ${if} $1 == '"'
        ${orIf} $1 == ""
          ${break}
        ${endif}
        IntOp $2 $2 + 1
      ${loop}
      ${if} $1 == '"'
        ; $1: the quoted exe path, $2: what follows the closing quote.
        IntOp $1 $2 - 1
        StrCpy $1 $0 $1 1
        IntOp $2 $2 + 1
        StrCpy $2 $0 "" $2
        ${if} $2 S== " /currentuser"
          ; The whole exe path normalised first, so a short file name
          ; (UNINST~1.EXE) is recognised too when the file exists.
          Push $1
          Call dnCanonical
          Pop $1
          ${GetFileName} $1 $2
          ${if} $1 != ""
          ${andIf} $2 == "${DN_UNINSTALLER_EXE}"
            ${GetParent} $1 $2
            Push $2
            Call dnCanonical
            Pop $3
          ${endif}
        ${endif}
      ${endif}
    ${endif}
    StrCpy $0 $3
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push LEGACY; Push NEW; Call dnCheckUninstallCommand; Pop REASON: "" when every
  ; uninstall command registered at $dnUninstallKey (and $dnUninstallKey2) is
  ; absent or exactly LEGACY's or NEW's own uninstaller (dnUninstallerDir), else why
  ; not. electron-builder's "uninstall old version" step runs whatever is
  ; registered there with /S --updated before the new copy exists; a command that
  ; cannot be parked would run the old uninstaller (and its broad process closer)
  ; and delete the old folder first, so the move must not start.
  Function dnCheckUninstallCommand
    Exch $1
    Exch
    Exch $0
    Push $2
    Push $3
    Push $4
    Push $0
    Call dnCanonical
    Pop $0
    Push $1
    Call dnCanonical
    Pop $1
    StrCpy $4 ""
    ReadRegStr $2 HKCU $dnUninstallKey "UninstallString"
    ${if} $2 != ""
      Push $2
      Call dnUninstallerDir
      Pop $3
      ${if} $3 != $0
      ${andIf} $3 != $1
        StrCpy $4 "the registered uninstall command is not the old folder's own uninstaller: $2"
      ${endif}
    ${endif}
    ${if} $4 == ""
    ${andIf} $dnUninstallKey2 != ""
      ReadRegStr $2 HKCU $dnUninstallKey2 "UninstallString"
      ${if} $2 != ""
        Push $2
        Call dnUninstallerDir
        Pop $3
        ${if} $3 != $0
        ${andIf} $3 != $1
          StrCpy $4 "the registered uninstall command is not the old folder's own uninstaller: $2"
        ${endif}
      ${endif}
    ${endif}
    ${if} $4 != ""
      StrCpy $dnWhy "uninstall-command"
    ${endif}
    StrCpy $0 $4
    Pop $4
    Pop $3
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Push LEGACY; Push NEW; Call dnParkUninstaller; Pop RESULT. Writes the journal
  ; (identity, both folders) and parks every registered uninstall command that is
  ; LEGACY's own uninstaller (the first one, verbatim, in LegacyUninstallString),
  ; so "uninstall old version" finds nothing to run and cannot delete the old
  ; folder before the new copy exists. Checks first (dnCheckUninstallCommand):
  ; if any command could not be parked, nothing is written. RESULT: "parked",
  ; "nothing to park" or "refused: <why>".
  Function dnParkUninstaller
    Exch $1
    Exch
    Exch $0
    Push $2
    Push $3
    Push $4
    Push $0
    Push $1
    Call dnCheckUninstallCommand
    Pop $4
    ${if} $4 != ""
      StrCpy $4 "refused: $4"
    ${else}
      ; Identity last: a journal cut short before it is incomplete, not trusted.
      WriteRegStr HKCU $dnJournalKey "SourceDir" $0
      !insertmacro dnTestStep "park-SourceDir"
      WriteRegStr HKCU $dnJournalKey "DestDir" $1
      !insertmacro dnTestStep "park-DestDir"
      WriteRegStr HKCU $dnJournalKey "Identity" "${DN_MIGRATION_IDENTITY}"
      !insertmacro dnFlushRegistry
      Push $0
      Call dnCanonical
      Pop $0
      StrCpy $4 "nothing to park"
      ReadRegStr $2 HKCU $dnUninstallKey "UninstallString"
      ${if} $2 != ""
        Push $2
        Call dnUninstallerDir
        Pop $3
        ${if} $3 == $0
          WriteRegStr HKCU $dnJournalKey "LegacyUninstallString" $2
          DeleteRegValue HKCU $dnUninstallKey "UninstallString"
          StrCpy $4 "parked"
        ${endif}
      ${endif}
      ${if} $dnUninstallKey2 != ""
        ReadRegStr $2 HKCU $dnUninstallKey2 "UninstallString"
        ${if} $2 != ""
          Push $2
          Call dnUninstallerDir
          Pop $3
          ${if} $3 == $0
            DeleteRegValue HKCU $dnUninstallKey2 "UninstallString"
            StrCpy $4 "parked"
          ${endif}
        ${endif}
      ${endif}
    ${endif}
    ${if} $4 == "parked"
      !insertmacro dnStatus park parked parked "from=$0 to=$1"
    ${elseif} $4 == "nothing to park"
      !insertmacro dnStatus park parked nothing-to-park "from=$0 to=$1"
    ${else}
      !insertmacro dnStatus park refused-park uninstall-command "from=$0 to=$1"
    ${endif}
    StrCpy $0 $4
    Pop $4
    Pop $3
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; The record of a completed move: MigrationRecord under $dnStateKey, one REG_SZ
  ; value, so writing (or restoring) it is a single registry write and a run cut
  ; short leaves all of it or none of it:
  ;
  ;   DNMR1|<DN_MIGRATION_IDENTITY>|<old folder>|<new folder>|<UTC, ISO 8601>|END
  ;
  ; (no folder can contain "|"; the identity's own two "|" are fixed). The app
  ; (src/main/windows-install-record.ts) acts only on a record in exactly this
  ; form for its own identity and leaves anything else for a later run to repair.
  !define DN_RECORD_VERSION "DNMR1"

  ; The record's time: exactly this shape, D an ASCII digit (UTC to the second, as
  ; dnWriteRecord writes it). The app requires the same shape (RECORD_TIME_SHAPE,
  ; src/main/windows-install-record.ts); both are checked against
  ; src/main/fixtures/install-record-times.json.
  !define DN_RECORD_TIME_SHAPE "DDDD-DD-DDTDD:DD:DDZ"

  ; Push VALUE; Call dnTimeCheck; Pop OK: "1" when VALUE has DN_RECORD_TIME_SHAPE.
  Function dnTimeCheck
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    StrLen $1 $0
    StrLen $2 "${DN_RECORD_TIME_SHAPE}"
    StrCpy $5 "0"
    ${if} $1 = $2
      StrCpy $5 "1"
      StrCpy $1 0
      ${do}
        ${if} $1 >= $2
          ${break}
        ${endif}
        StrCpy $3 $0 1 $1
        StrCpy $4 "${DN_RECORD_TIME_SHAPE}" 1 $1
        ${if} $4 S== "D"
          ; A digit is the one character that reads back as itself as a number.
          IntOp $4 $3 + 0
          ${if} $4 S!= $3
            StrCpy $5 "0"
            ${break}
          ${endif}
        ${elseif} $3 S!= $4
          StrCpy $5 "0"
          ${break}
        ${endif}
        IntOp $1 $1 + 1
      ${loop}
    ${endif}
    StrCpy $0 $5
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push VALUE; Call dnRecordCheck; Pop REASON: "" when VALUE is a complete record
  ; for this identity naming exactly <Programs>\APP_FILENAME -> <Programs>\
  ; PRODUCT_FILENAME (compared canonical) at a time of DN_RECORD_TIME_SHAPE; else
  ; "none" (empty), "format", "identity", "time" or "folders". Recovery, save and
  ; restore treat anything but "" as no record: a live one is replaced from a
  ; complete copy, and never copied over one.
  Function dnRecordCheck
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    Push $6
    StrLen $2 "${DN_RECORD_VERSION}|"
    StrCpy $3 $0 $2
    StrLen $4 "${DN_RECORD_VERSION}|${DN_MIGRATION_IDENTITY}|"
    StrCpy $5 $0 $4
    ${if} $0 == ""
      StrCpy $0 "none"
    ${elseif} $3 S!= "${DN_RECORD_VERSION}|"
      StrCpy $0 "format"
    ${elseif} $5 != "${DN_RECORD_VERSION}|${DN_MIGRATION_IDENTITY}|"
      StrCpy $0 "identity"
    ${else}
      ; The rest is <old>|<new>|<at>|END: $3, $4, $5 and $6; $1 counts the "|".
      StrCpy $0 $0 "" $4
      StrCpy $1 0
      StrCpy $3 ""
      StrCpy $4 ""
      StrCpy $5 ""
      StrCpy $6 ""
      ${do}
        StrCpy $2 $0 1
        StrCpy $0 $0 "" 1
        ${if} $2 == ""
          ${break}
        ${elseif} $2 == "|"
          IntOp $1 $1 + 1
        ${elseif} $1 = 0
          StrCpy $3 "$3$2"
        ${elseif} $1 = 1
          StrCpy $4 "$4$2"
        ${elseif} $1 = 2
          StrCpy $5 "$5$2"
        ${elseif} $1 = 3
          StrCpy $6 "$6$2"
        ${endif}
      ${loop}
      ${if} $1 != 3
      ${orIf} $6 S!= "END"
      ${orIf} $3 == ""
      ${orIf} $4 == ""
      ${orIf} $5 == ""
        StrCpy $0 "format"
      ${else}
        Push $5
        Call dnTimeCheck
        Pop $5
      ${endif}
      ${if} $0 == "format"
      ${elseif} $5 != "1"
        StrCpy $0 "time"
      ${else}
        Push $dnProgramsRoot
        Call dnCanonical
        Pop $1
        Push $3
        Call dnCanonical
        Pop $3
        Push $4
        Call dnCanonical
        Pop $4
        ${if} $1 != ""
        ${andIf} $3 == "$1\${APP_FILENAME}"
        ${andIf} $4 == "$1\${PRODUCT_FILENAME}"
          StrCpy $0 ""
        ${else}
          StrCpy $0 "folders"
        ${endif}
      ${endif}
    ${endif}
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push LEGACY; Push NEW; Call dnWriteRecord; Pop RESULT: writes the record of a
  ; move from LEGACY to NEW (now, UTC) in one write and reads it back: "written"
  ; or "failed".
  Function dnWriteRecord
    Exch $1
    Exch
    Exch $0
    Push $2
    Push $3
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6
    Push $0
    Call dnCanonical
    Pop $2
    Push $1
    Call dnCanonical
    Pop $3
    ${GetTime} "" "LS" $R0 $R1 $R2 $R3 $R4 $R5 $R6
    IntFmt $R0 "%02u" $R0
    IntFmt $R1 "%02u" $R1
    IntFmt $R4 "%02u" $R4
    IntFmt $R5 "%02u" $R5
    IntFmt $R6 "%02u" $R6
    StrCpy $2 "${DN_RECORD_VERSION}|${DN_MIGRATION_IDENTITY}|$2|$3|$R2-$R1-$R0T$R4:$R5:$R6Z|END"
    WriteRegStr HKCU $dnStateKey "MigrationRecord" $2
    ReadRegStr $3 HKCU $dnStateKey "MigrationRecord"
    ${if} $3 S== $2
      !insertmacro dnFlushRegistry
      StrCpy $2 "written"
      !insertmacro dnStatus record moved record-written "from=$0 to=$1"
    ${else}
      StrCpy $2 "failed"
      !insertmacro dnStatus record moved record-failed "from=$0 to=$1"
    ${endif}
    StrCpy $0 $2
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
    Pop $3
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Push KEY; Call dnJournalCheck; Pop REASON: "" when the journal values at
  ; HKCU\KEY are complete (Identity, SourceDir and DestDir all there) and name this
  ; identity and exactly <Programs>\APP_FILENAME -> <Programs>\PRODUCT_FILENAME
  ; (compared canonical); else "none" (none of the three), "incomplete",
  ; "identity" or "folders".
  Function dnJournalCheck
    Exch $0
    Push $1
    Push $2
    Push $3
    ReadRegStr $1 HKCU $0 "Identity"
    ReadRegStr $2 HKCU $0 "SourceDir"
    ReadRegStr $3 HKCU $0 "DestDir"
    ${if} $1 == ""
    ${andIf} $2 == ""
    ${andIf} $3 == ""
      StrCpy $0 "none"
    ${elseif} $1 == ""
    ${orIf} $2 == ""
    ${orIf} $3 == ""
      StrCpy $0 "incomplete"
    ${elseif} $1 != "${DN_MIGRATION_IDENTITY}"
      StrCpy $0 "identity"
    ${else}
      Push $dnProgramsRoot
      Call dnCanonical
      Pop $1
      Push $2
      Call dnCanonical
      Pop $2
      Push $3
      Call dnCanonical
      Pop $3
      ${if} $1 != ""
      ${andIf} $2 == "$1\${APP_FILENAME}"
      ${andIf} $3 == "$1\${PRODUCT_FILENAME}"
        StrCpy $0 ""
      ${else}
        StrCpy $0 "folders"
      ${endif}
    ${endif}
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push DEST; Call dnJournalDone; Pop LEGACY: the old folder of a move an earlier
  ; run removed and then stopped before it wrote the record (dnFinishMigration
  ; writes the record before it clears the journal): the journal is complete for
  ; this identity (dnJournalCheck) and DEST, and its old folder is not there at
  ; all (not even as a link). "" otherwise. customInstall finishes such a move
  ; (dnCompleteMove).
  Function dnJournalDone
    Exch $0
    Push $1
    Push $2
    Push $dnJournalKey
    Call dnJournalCheck
    Pop $1
    ${if} $1 == ""
      ReadRegStr $1 HKCU $dnJournalKey "DestDir"
      Push $1
      Call dnCanonical
      Pop $1
      Push $0
      Call dnCanonical
      Pop $0
      ${if} $0 != ""
      ${andIf} $1 == $0
        ReadRegStr $1 HKCU $dnJournalKey "SourceDir"
        Push $1
        Call dnCanonical
        Pop $1
        System::Call 'kernel32::GetFileAttributesW(w r1) i.r2 ?e'
        Pop $0
        ; ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND: gone, not unreadable.
        ${if} $2 = -1
        ${andIf} $0 = 2
          StrCpy $0 $1
        ${elseif} $2 = -1
        ${andIf} $0 = 3
          StrCpy $0 $1
        ${else}
          StrCpy $0 ""
        ${endif}
      ${else}
        StrCpy $0 ""
      ${endif}
    ${else}
      StrCpy $0 ""
    ${endif}
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push LEGACY; Push NEW; Call dnCompleteMove: what dnFinishMigration does after
  ; its removal, for a move dnJournalDone found removed but unrecorded: writes the
  ; record unless a complete one is there already, then clears the journal (kept
  ; if the record could not be written, so the next run tries again).
  Function dnCompleteMove
    Exch $1
    Exch
    Exch $0
    Push $2
    ReadRegStr $2 HKCU $dnStateKey "MigrationRecord"
    Push $2
    Call dnRecordCheck
    Pop $2
    ${if} $2 != ""
      Push $0
      Push $1
      Call dnWriteRecord
      Pop $2
    ${else}
      StrCpy $2 "written"
    ${endif}
    ${if} $2 == "written"
      DeleteRegKey HKCU $dnJournalKey
      !insertmacro dnStatus install moved journal-completed "from=$0 to=$1"
    ${endif}
    Pop $2
    Pop $0
    Pop $1
  FunctionEnd

  ; Call dnSaveState / Call dnRestoreState / Call dnRecoverState.
  ; electron-builder's uninstaller, which "uninstall old version" runs (with
  ; --updated) on every update once the uninstall entry names an installed copy,
  ; deletes HKCU\Software\${APP_GUID}: the journal ($dnJournalKey, a subkey) and the
  ; record ($dnStateKey). dnSaveState, called right before that step, copies both
  ; to the recovery key $dnRecoveryKey (HKCU\Software\DoodleNote-InstallRecovery\
  ; ${APP_GUID}: outside the deleted subtree, still one per identity), and also
  ; keeps them in memory. customInit calls dnRecoverState first, so an installer
  ; that died between "uninstall old version" and customInstall loses nothing;
  ; dnRestoreState, first thing in customInstall, calls it and then fills anything
  ; still missing from memory. So an unfinished move stays armed across any number
  ; of runs, and a record the app has not consumed yet survives another update,
  ; even an interrupted one.
  ;
  ; Every step can be cut short and picked up by the next run:
  ; - A new copy is valid only once RecoveryFor (written last) names this
  ;   identity. A copy kept from an earlier run (dnRecoverState could not finish
  ;   with it) is updated in place, one value at a time, and only from live state
  ;   that is itself complete, so it stays valid between any two writes.
  ; - dnRecoverState uses each part of the copy (journal, record) only after
  ;   checking it: complete, this identity, exactly this identity's two folders
  ;   (dnJournalCheck, dnRecordCheck). It writes every journal value that is
  ;   missing or empty, Identity last, so a journal cut short is incomplete and
  ;   the next run fills the rest; the record is one value. It deletes the copy
  ;   only once every value in it reads back from the live keys exactly, and then
  ;   the parent key if no other identity's copy is in it. A copy that fails its
  ;   checks is left alone (a user uninstall deletes it).
  !macro dnCopyValue FROM TO NAME
    ReadRegStr $0 HKCU ${FROM} "${NAME}"
    ${if} $0 != ""
      WriteRegStr HKCU ${TO} "${NAME}" $0
    ${else}
      DeleteRegValue HKCU ${TO} "${NAME}"
    ${endif}
  !macroend

  Function dnSaveState
    ReadRegStr $dnSavedIdentity HKCU $dnJournalKey "Identity"
    ReadRegStr $dnSavedSource HKCU $dnJournalKey "SourceDir"
    ReadRegStr $dnSavedDest HKCU $dnJournalKey "DestDir"
    ReadRegStr $dnSavedUninstall HKCU $dnJournalKey "LegacyUninstallString"
    ReadRegStr $dnSavedDesktop HKCU $dnJournalKey "DesktopLink"
    ReadRegStr $dnSavedStartMenu HKCU $dnJournalKey "StartMenuLink"
    ReadRegStr $dnSavedRecord HKCU $dnStateKey "MigrationRecord"
    ${if} $dnRecoveryKey != ""
      Push $0
      Push $1
      Push $2
      ReadRegStr $0 HKCU $dnRecoveryKey "RecoveryFor"
      ${if} $0 != "${DN_MIGRATION_IDENTITY}"
        ; Not a copy for this identity, or one cut short: start a new one.
        DeleteRegKey HKCU $dnRecoveryKey
      ${endif}
      Push $dnJournalKey
      Call dnJournalCheck
      Pop $1
      Push $dnSavedRecord
      Call dnRecordCheck
      Pop $2
      ; Only complete live state replaces what the copy holds; a part that is not
      ; complete here keeps the copy's (an earlier run's, not yet restored).
      ${if} $1 == ""
      ${orIf} $2 == ""
        ClearErrors
        ${if} $1 == ""
          !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "Identity"
          !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "SourceDir"
          !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "DestDir"
          !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "LegacyUninstallString"
          !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "DesktopLink"
          !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "StartMenuLink"
          !insertmacro dnTestStep "save-journal"
        ${endif}
        ${if} $2 == ""
          WriteRegStr HKCU $dnRecoveryKey "MigrationRecord" $dnSavedRecord
          !insertmacro dnTestStep "save-record"
        ${endif}
        ; Last: a new copy without it (cut short) is ignored.
        WriteRegStr HKCU $dnRecoveryKey "RecoveryFor" "${DN_MIGRATION_IDENTITY}"
        !insertmacro dnFlushRegistry
        ${if} ${Errors}
          DetailPrint "The install state could not be copied to HKCU\$dnRecoveryKey; it is kept for this run only"
        ${endif}
      ${endif}
      Pop $2
      Pop $1
      Pop $0
    ${endif}
  FunctionEnd

  ; In dnRecoverState: the journal value NAME from the copy, if the journal has
  ; none (or an empty one).
  !macro dnRecoverValue NAME
    ReadRegStr $2 HKCU $dnRecoveryKey "${NAME}"
    ${if} $2 != ""
      ReadRegStr $3 HKCU $dnJournalKey "${NAME}"
      ${if} $3 == ""
        WriteRegStr HKCU $dnJournalKey "${NAME}" $2
        !insertmacro dnTestStep "recover-${NAME}"
      ${endif}
    ${endif}
  !macroend

  ; In dnRecoverState: $5 = "journal-mismatch" unless the journal's NAME reads
  ; back exactly as the copy has it.
  !macro dnMatchValue NAME
    ReadRegStr $2 HKCU $dnRecoveryKey "${NAME}"
    ReadRegStr $3 HKCU $dnJournalKey "${NAME}"
    ${if} $2 != ""
    ${andIf} $3 S!= $2
      StrCpy $5 "journal-mismatch"
    ${endif}
  !macroend

  Function dnRecoverState
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    StrCpy $0 ""
    ${if} $dnRecoveryKey != ""
      ReadRegStr $0 HKCU $dnRecoveryKey "RecoveryFor"
    ${endif}
    ${if} $0 == "${DN_MIGRATION_IDENTITY}"
      ; $4: the parts of the copy that passed their checks ("j", "r", "jr").
      ; $5: why the copy must stay, the first reason found ("" = everything in it
      ; is live again).
      StrCpy $4 ""
      StrCpy $5 ""
      Push $dnRecoveryKey
      Call dnJournalCheck
      Pop $1
      ${if} $1 == ""
        StrCpy $4 "j"
        ; Every value the journal is missing; the three that make it complete
        ; last, Identity very last.
        !insertmacro dnRecoverValue "LegacyUninstallString"
        !insertmacro dnRecoverValue "DesktopLink"
        !insertmacro dnRecoverValue "StartMenuLink"
        !insertmacro dnRecoverValue "SourceDir"
        !insertmacro dnRecoverValue "DestDir"
        !insertmacro dnRecoverValue "Identity"
      ${elseif} $1 != "none"
        StrCpy $5 "journal-$1"
      ${endif}
      ReadRegStr $2 HKCU $dnRecoveryKey "MigrationRecord"
      Push $2
      Call dnRecordCheck
      Pop $1
      ${if} $1 == ""
        StrCpy $4 "$4r"
        ReadRegStr $3 HKCU $dnStateKey "MigrationRecord"
        Push $3
        Call dnRecordCheck
        Pop $3
        ${if} $3 != ""
          ; None, or not a complete record for this identity: the copy's, whole.
          WriteRegStr HKCU $dnStateKey "MigrationRecord" $2
          !insertmacro dnTestStep "recover-MigrationRecord"
        ${endif}
      ${elseif} $1 != "none"
      ${andIf} $5 == ""
        StrCpy $5 "record-$1"
      ${endif}
      ; Before the copy goes, every value in it must read back from the live keys.
      ${if} $5 == ""
        ${if} $4 == "j"
        ${orIf} $4 == "jr"
          !insertmacro dnMatchValue "Identity"
          !insertmacro dnMatchValue "SourceDir"
          !insertmacro dnMatchValue "DestDir"
          !insertmacro dnMatchValue "LegacyUninstallString"
          !insertmacro dnMatchValue "DesktopLink"
          !insertmacro dnMatchValue "StartMenuLink"
        ${endif}
        ${if} $4 == "r"
        ${orIf} $4 == "jr"
          ReadRegStr $2 HKCU $dnRecoveryKey "MigrationRecord"
          ReadRegStr $3 HKCU $dnStateKey "MigrationRecord"
          ${if} $3 S!= $2
            StrCpy $5 "record-mismatch"
          ${endif}
        ${endif}
      ${endif}
      ${if} $5 == ""
        ; What was restored is on disk before the copy goes.
        !insertmacro dnFlushRegistry
        DeleteRegKey HKCU $dnRecoveryKey
        !insertmacro dnTestStep "recover-deleted"
        ${if} $dnRecoveryParent != ""
          ; Only when no other identity's copy is in it.
          DeleteRegKey /ifempty HKCU $dnRecoveryParent
        ${endif}
        ${if} $4 != ""
          !insertmacro dnStatus recover recovered restored ""
        ${endif}
      ${elseif} $4 == ""
        DetailPrint "Ignored HKCU\$dnRecoveryKey: it does not name this install's folders ($5)"
        !insertmacro dnStatus recover recovery-ignored $5 ""
      ${else}
        DetailPrint "Kept HKCU\$dnRecoveryKey: not all of it could be put back ($5)"
        !insertmacro dnStatus recover recover-incomplete $5 ""
      ${endif}
    ${elseif} $0 != ""
      !insertmacro dnStatus recover recovery-ignored recovery-foreign ""
    ${elseif} $dnRecoveryParent != ""
      ; No copy: a run that stopped right after deleting one left the parent.
      DeleteRegKey /ifempty HKCU $dnRecoveryParent
    ${endif}
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  ; In dnRestoreState: the journal value NAME from memory, if the journal has none.
  !macro dnRestoreValue KEY NAME VALUE
    ${if} ${VALUE} != ""
      ReadRegStr $0 HKCU ${KEY} "${NAME}"
      ${if} $0 == ""
        WriteRegStr HKCU ${KEY} "${NAME}" ${VALUE}
      ${endif}
    ${endif}
  !macroend

  Function dnRestoreState
    Call dnRecoverState
    Push $0
    ; Identity last, as in dnRecoverState.
    !insertmacro dnRestoreValue $dnJournalKey "LegacyUninstallString" $dnSavedUninstall
    !insertmacro dnRestoreValue $dnJournalKey "DesktopLink" $dnSavedDesktop
    !insertmacro dnRestoreValue $dnJournalKey "StartMenuLink" $dnSavedStartMenu
    !insertmacro dnRestoreValue $dnJournalKey "SourceDir" $dnSavedSource
    !insertmacro dnRestoreValue $dnJournalKey "DestDir" $dnSavedDest
    !insertmacro dnRestoreValue $dnJournalKey "Identity" $dnSavedIdentity
    ; The record, whole, when no complete one is there now.
    ReadRegStr $0 HKCU $dnStateKey "MigrationRecord"
    Push $0
    Call dnRecordCheck
    Pop $0
    ${if} $0 != ""
      Push $dnSavedRecord
      Call dnRecordCheck
      Pop $0
      ${if} $0 == ""
        WriteRegStr HKCU $dnStateKey "MigrationRecord" $dnSavedRecord
        !insertmacro dnFlushRegistry
      ${endif}
    ${endif}
    Pop $0
  FunctionEnd
!endif
