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
; $dnStateKey, $dnUninstallKey and $dnUninstallKey2 (all HKCU) before calling the
; functions below.
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
!macroend

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
      ${if} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" IDOK`
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
      SetErrorLevel 2
      Quit
    ${endif}
    ${ifnot} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" IDRETRY`
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
      StrCpy $5 "a path is not valid"
    ${elseif} $0 != "$2\${APP_FILENAME}"
      StrCpy $5 "the old folder is not $2\${APP_FILENAME}"
    ${elseif} $1 != "$2\${PRODUCT_FILENAME}"
      StrCpy $5 "the new folder is not $2\${PRODUCT_FILENAME}"
    ${endif}
    ${if} $5 == ""
      Push $0
      Push $1
      Call ${DN_FN}dnOverlaps
      Pop $3
      ${if} $3 == "1"
        StrCpy $5 "the old and new folders overlap"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $dnProfileDir
      Call ${DN_FN}dnCanonical
      Pop $3
      ${if} $3 == ""
        StrCpy $5 "the profile path is not valid"
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
          StrCpy $5 "a folder overlaps the app profile"
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $0
      Call ${DN_FN}dnAttributes
      Pop $3
      IntOp $4 $3 & ${DN_ATTR_REPARSE_POINT}
      ${if} $3 = -1
        StrCpy $5 "the old folder does not exist"
      ${elseif} $4 <> 0
        StrCpy $5 "the old folder is a junction or link"
      ${else}
        IntOp $4 $3 & ${DN_ATTR_DIRECTORY}
        ${if} $4 = 0
          StrCpy $5 "the old folder is not a folder"
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
        StrCpy $5 "the old folder has no ${DN_APP_EXE}"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $1
      Call ${DN_FN}dnAttributes
      Pop $3
      ${if} $3 <> -1
        IntOp $4 $3 & 0x410
        ${if} $4 <> ${DN_ATTR_DIRECTORY}
          StrCpy $5 "the new folder is a junction, link or file"
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
        StrCpy $5 "a folder cannot be opened"
      ${elseif} $3 != "$2\${APP_FILENAME}"
        StrCpy $5 "the old folder resolves to $3"
      ${else}
        Push $1
        Call ${DN_FN}dnAttributes
        Pop $4
        ${if} $4 <> -1
          Push $1
          Call ${DN_FN}dnFinalPath
          Pop $4
          ${if} $4 == ""
            StrCpy $5 "the new folder cannot be opened"
          ${else}
            Push $3
            Push $4
            Call ${DN_FN}dnOverlaps
            Pop $4
            ${if} $4 == "1"
              StrCpy $5 "the old and new folders resolve to the same place"
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
        StrCpy $5 "a folder or the app profile cannot be resolved"
      ${else}
        Push $3
        Push $2
        Call ${DN_FN}dnOverlaps
        Pop $2
        ${if} $2 == "1"
          StrCpy $5 "the old folder really overlaps the app profile"
        ${else}
          Push $dnProfileDir
          Call ${DN_FN}dnResolved
          Pop $2
          Push $4
          Push $2
          Call ${DN_FN}dnOverlaps
          Pop $2
          ${if} $2 == "1"
            StrCpy $5 "the new folder really overlaps the app profile"
          ${else}
            Push $3
            Push $4
            Call ${DN_FN}dnOverlaps
            Pop $2
            ${if} $2 == "1"
              StrCpy $5 "the old and new folders resolve to the same place"
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
    Push $0
    Call ${DN_FN}dnCanonical
    Pop $2
    ${if} $2 == ""
      StrCpy $5 "a path is not valid"
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
        StrCpy $5 "the old folder cannot be opened"
      ${elseif} $5 == ""
      ${andIf} $dnPinParent = 0
        StrCpy $5 "the old folder cannot be opened"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $dnPinRoot
      Call ${DN_FN}dnHandleAttributes
      Pop $3
      IntOp $4 $3 & 0x410
      ${if} $3 = -1
      ${orIf} $4 <> ${DN_ATTR_DIRECTORY}
        StrCpy $5 "the pinned old folder is not a real folder"
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
        StrCpy $5 "a pinned folder cannot be read"
      ${elseif} $2 != "$3\${APP_FILENAME}"
        StrCpy $5 "the pinned old folder is $2, not in $3"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push "$2\${DN_APP_EXE}"
      Push 0x80
      Push 7
      Call ${DN_FN}dnOpenNoFollow
      Pop $4
      ${if} $4 = 0
        StrCpy $5 "the pinned old folder has no ${DN_APP_EXE}"
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
          StrCpy $5 "the pinned old folder has no ${DN_APP_EXE}"
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
        StrCpy $5 "a pinned folder or the app profile cannot be read"
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
          StrCpy $5 "the pinned old folder overlaps the app profile"
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $dnPinDest
      Push $1
      Call ${DN_FN}dnWhereIs
      Pop $3
      ${if} $3 == ""
        StrCpy $5 "the new folder cannot be read"
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
          StrCpy $5 "the pinned old folder overlaps the new folder"
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
        StrCpy $0 ""
      ${else}
        Push $2
        Push $0
        Call ${DN_FN}dnCheckLegacyDir
        Pop $1
        ${if} $1 != ""
          StrCpy $dnPlanNote "the migration journal for $2: $1"
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
  ; Push DEST; Call dnUninstallLegacy; Pop RESULT. A user uninstall (not --updated)
  ; of the copy in DEST while a move into DEST is unfinished (a trusted journal,
  ; dnTrustedJournal) also removes the old folder that move left behind, after the
  ; same checks and with the same handle-verified removal, because electron-builder's
  ; uninstaller deletes the journal and nothing would ever finish the move. The app
  ; there is closed only with consent ($dnClosePolicy). RESULT: "none" (no unfinished
  ; move), "removed", or "kept: <why>": the old folder then stays as a stale copy
  ; without an uninstall entry, which the next install of this app finds at the old
  ; default folder and moves away (dnPlanMigration).
  Function ${DN_FN}dnUninstallLegacy
    Exch $0
    Push $1
    Push $2
    Push $0
    Call ${DN_FN}dnTrustedJournal
    Pop $1
    ${if} $1 == ""
      StrCpy $0 "none"
    ${else}
      !insertmacro dnCloseAppIn "$1" $dnClosePolicy $dnCloseResult
      ${if} $dnCloseResult != "none"
      ${andIf} $dnCloseResult != "closed"
        StrCpy $0 "kept: ${PRODUCT_NAME} there is $dnCloseResult"
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
          ${else}
            StrCpy $0 "kept: a file is still in use"
          ${endif}
        ${endif}
      ${endif}
      DetailPrint "$1: $0"
    ${endif}
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
  Var dnSavedFrom
  Var dnSavedTo
  Var dnSavedAt
  Var dnRecoveryKey

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
    Push $dnPlanDir
    Call dnCanonical
    Pop $0
    Push $dnProgramsRoot
    Call dnCanonical
    Pop $1
    ${if} $0 == ""
    ${orIf} $1 == ""
      StrCpy $dnPlanNote "a path is not valid"
    ${else}
      ${GetFileName} $0 $2
      ${GetParent} $0 $3
      ${if} $2 != "${APP_FILENAME}"
        ; Not the old default folder name: nothing to do.
      ${elseif} $3 != $1
        StrCpy $dnPlanNote "$0 is not in $1"
      ${elseif} ${FileExists} "$0\${DN_APP_EXE}"
        Push $0
        Push "$1\${PRODUCT_FILENAME}"
        Call dnCheckLegacyDir
        Pop $2
        ${if} $2 == ""
          StrCpy $dnPlanLegacy $0
          StrCpy $dnPlanDir "$1\${PRODUCT_FILENAME}"
        ${else}
          StrCpy $dnPlanNote $2
        ${endif}
      ${else}
        ; A fresh install to the default folder gets the new name.
        StrCpy $dnPlanDir "$1\${PRODUCT_FILENAME}"
      ${endif}
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
  ; old app running quits with exit code 2 and changes nothing.
  Function dnMigrationClose
    Exch $1
    Exch
    Exch $0
    Push $2
    StrCpy $2 "0"
    !insertmacro dnCloseAppIn "$0" $dnClosePolicy $dnCloseResult
    ${if} $dnCloseResult == "cancel"
      Quit
    ${elseif} $dnCloseResult == "running"
    ${andIf} $dnClosePolicy == "never"
      ; A silent install nobody asked the app for (/S without --updated) closes
      ; nothing, and installing the new copy beside the running old one would leave
      ; that one running, starting at login and holding the single-instance lock
      ; the new exe needs. Quit before anything changed, like an in-place install.
      DetailPrint `"${PRODUCT_NAME}" is running from $0 and a silent install without --updated does not close it; nothing was changed`
      SetErrorLevel 2
      Quit
    ${elseif} $dnCloseResult != "none"
    ${andIf} $dnCloseResult != "closed"
      StrCpy $2 "1"
      DetailPrint "Keeping $0 until ${PRODUCT_NAME} there can be closed"
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
  ; Only after a real move (the old folder is gone) does it record MigratedFrom,
  ; MigratedTo and MigratedAt under $dnStateKey. The app repoints its login item
  ; and MCP client entries only when that record names its own folder
  ; (src/main/windows-install-migration.ts), never because of a folder name.
  Function dnFinishMigration
    Exch $2
    Exch
    Exch $1
    Exch 2
    Exch $0
    Push $3
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6
    StrCpy $3 ""
    ${if} $2 != "1"
      Push $0
      Push $1
      Call dnPinLegacy
      Pop $3
    ${endif}
    ${if} $2 == "1"
      StrCpy $3 "kept: ${PRODUCT_NAME} there is still running"
    ${elseif} $3 != ""
      StrCpy $3 "kept: $3"
    ${else}
      Push $0
      Call dnRemoveLegacyDir
      Pop $3
      Call dnUnpin
      ${if} $3 == "removed"
        DeleteRegKey HKCU $dnJournalKey
        Push $0
        Call dnCanonical
        Pop $2
        WriteRegStr HKCU $dnStateKey "MigratedFrom" $2
        Push $1
        Call dnCanonical
        Pop $2
        WriteRegStr HKCU $dnStateKey "MigratedTo" $2
        ; UTC, ISO 8601.
        ${GetTime} "" "LS" $R0 $R1 $R2 $R3 $R4 $R5 $R6
        IntFmt $R0 "%02u" $R0
        IntFmt $R1 "%02u" $R1
        IntFmt $R4 "%02u" $R4
        IntFmt $R5 "%02u" $R5
        IntFmt $R6 "%02u" $R6
        WriteRegStr HKCU $dnStateKey "MigratedAt" "$R2-$R1-$R0T$R4:$R5:$R6Z"
      ${elseif} $3 == "unsafe"
        StrCpy $3 "kept: something in the old folder failed an identity check while it was being removed; removal stopped"
      ${else}
        StrCpy $3 "kept: a file is still in use"
      ${endif}
    ${endif}
    DetailPrint "$0: $3"
    StrCpy $0 $3
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
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
  ; ("<DIR>\DN_UNINSTALLER_EXE" /currentuser, nothing else), DIR normalised with
  ; dnCanonical (an install registered through short names, C:\Users\LONGUS~1\...,
  ; is recognised); "" when COMMAND is anything else.
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
          ${GetFileName} $1 $2
          ${if} $2 == "${DN_UNINSTALLER_EXE}"
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
      WriteRegStr HKCU $dnJournalKey "Identity" "${DN_MIGRATION_IDENTITY}"
      WriteRegStr HKCU $dnJournalKey "SourceDir" $0
      WriteRegStr HKCU $dnJournalKey "DestDir" $1
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
    StrCpy $0 $4
    Pop $4
    Pop $3
    Pop $2
    Exch $0
    Exch
    Pop $1
  FunctionEnd

  ; Call dnSaveState / Call dnRestoreState / Call dnRecoverState.
  ; electron-builder's uninstaller, which "uninstall old version" runs (with
  ; --updated) on every update once the uninstall entry names an installed copy,
  ; deletes HKCU\Software\${APP_GUID}: the journal ($dnJournalKey, a subkey) and the
  ; MigratedFrom / MigratedTo / MigratedAt record ($dnStateKey). dnSaveState, called
  ; right before that step, copies both to the recovery key $dnRecoveryKey
  ; (HKCU\Software\DoodleNote-InstallRecovery\${APP_GUID}: outside the deleted
  ; subtree, still one per identity), and also keeps them in memory. dnRecoverState
  ; writes back every value that is missing from the recovery key, after checking
  ; it: written for this identity (RecoveryFor, written last), the journal naming
  ; this identity and exactly <Programs>\APP_FILENAME -> <Programs>\PRODUCT_FILENAME,
  ; the record naming those same two folders. It deletes the recovery key only once
  ; what it restored reads back. customInit calls it first, so an installer that died
  ; between "uninstall old version" and customInstall loses nothing: the next run
  ; finds the journal and record again. dnRestoreState, first thing in customInstall,
  ; calls it and then fills anything still missing from memory. So an unfinished
  ; move stays armed across any number of runs, and a record the app has not
  ; consumed yet survives another update, even an interrupted one.
  !macro dnCopyValue FROM TO NAME
    ReadRegStr $0 HKCU ${FROM} "${NAME}"
    ${if} $0 != ""
      WriteRegStr HKCU ${TO} "${NAME}" $0
    ${endif}
  !macroend

  Function dnSaveState
    ReadRegStr $dnSavedIdentity HKCU $dnJournalKey "Identity"
    ReadRegStr $dnSavedSource HKCU $dnJournalKey "SourceDir"
    ReadRegStr $dnSavedDest HKCU $dnJournalKey "DestDir"
    ReadRegStr $dnSavedUninstall HKCU $dnJournalKey "LegacyUninstallString"
    ReadRegStr $dnSavedDesktop HKCU $dnJournalKey "DesktopLink"
    ReadRegStr $dnSavedStartMenu HKCU $dnJournalKey "StartMenuLink"
    ReadRegStr $dnSavedFrom HKCU $dnStateKey "MigratedFrom"
    ReadRegStr $dnSavedTo HKCU $dnStateKey "MigratedTo"
    ReadRegStr $dnSavedAt HKCU $dnStateKey "MigratedAt"
    ${if} $dnRecoveryKey != ""
      Push $0
      DeleteRegKey HKCU $dnRecoveryKey
      ${if} $dnSavedIdentity != ""
      ${orIf} $dnSavedTo != ""
        ClearErrors
        !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "Identity"
        !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "SourceDir"
        !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "DestDir"
        !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "LegacyUninstallString"
        !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "DesktopLink"
        !insertmacro dnCopyValue $dnJournalKey $dnRecoveryKey "StartMenuLink"
        !insertmacro dnCopyValue $dnStateKey $dnRecoveryKey "MigratedFrom"
        !insertmacro dnCopyValue $dnStateKey $dnRecoveryKey "MigratedTo"
        !insertmacro dnCopyValue $dnStateKey $dnRecoveryKey "MigratedAt"
        ; Last: a copy without it (cut short) is ignored.
        WriteRegStr HKCU $dnRecoveryKey "RecoveryFor" "${DN_MIGRATION_IDENTITY}"
        ${if} ${Errors}
          DetailPrint "The install state could not be copied to HKCU\$dnRecoveryKey; it is kept for this run only"
        ${endif}
      ${endif}
      Pop $0
    ${endif}
  FunctionEnd

  !macro dnRestoreValue KEY NAME VALUE
    ${if} ${VALUE} != ""
      ReadRegStr $0 HKCU ${KEY} "${NAME}"
      ${if} $0 == ""
        WriteRegStr HKCU ${KEY} "${NAME}" ${VALUE}
      ${endif}
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
      ; $5: "1" while everything restored reads back.
      StrCpy $5 "1"
      Push $dnProgramsRoot
      Call dnCanonical
      Pop $1
      ReadRegStr $2 HKCU $dnRecoveryKey "Identity"
      ReadRegStr $3 HKCU $dnRecoveryKey "SourceDir"
      Push $3
      Call dnCanonical
      Pop $3
      ReadRegStr $4 HKCU $dnRecoveryKey "DestDir"
      Push $4
      Call dnCanonical
      Pop $4
      ${if} $1 != ""
      ${andIf} $2 == "${DN_MIGRATION_IDENTITY}"
      ${andIf} $3 == "$1\${APP_FILENAME}"
      ${andIf} $4 == "$1\${PRODUCT_FILENAME}"
        ReadRegStr $2 HKCU $dnRecoveryKey "Identity"
        !insertmacro dnRestoreValue $dnJournalKey "Identity" $2
        ReadRegStr $2 HKCU $dnRecoveryKey "SourceDir"
        !insertmacro dnRestoreValue $dnJournalKey "SourceDir" $2
        ReadRegStr $2 HKCU $dnRecoveryKey "DestDir"
        !insertmacro dnRestoreValue $dnJournalKey "DestDir" $2
        ReadRegStr $2 HKCU $dnRecoveryKey "LegacyUninstallString"
        !insertmacro dnRestoreValue $dnJournalKey "LegacyUninstallString" $2
        ReadRegStr $2 HKCU $dnRecoveryKey "DesktopLink"
        !insertmacro dnRestoreValue $dnJournalKey "DesktopLink" $2
        ReadRegStr $2 HKCU $dnRecoveryKey "StartMenuLink"
        !insertmacro dnRestoreValue $dnJournalKey "StartMenuLink" $2
        ReadRegStr $2 HKCU $dnJournalKey "Identity"
        ${if} $2 == ""
          StrCpy $5 "0"
        ${endif}
      ${endif}
      ; The record is restored only as a whole, and only when none is there now.
      ReadRegStr $2 HKCU $dnRecoveryKey "MigratedFrom"
      Push $2
      Call dnCanonical
      Pop $2
      ReadRegStr $3 HKCU $dnRecoveryKey "MigratedTo"
      Push $3
      Call dnCanonical
      Pop $3
      ReadRegStr $4 HKCU $dnRecoveryKey "MigratedAt"
      ${if} $1 != ""
      ${andIf} $2 == "$1\${APP_FILENAME}"
      ${andIf} $3 == "$1\${PRODUCT_FILENAME}"
      ${andIf} $4 != ""
        ReadRegStr $0 HKCU $dnStateKey "MigratedTo"
        ${if} $0 == ""
          ReadRegStr $2 HKCU $dnRecoveryKey "MigratedFrom"
          ReadRegStr $3 HKCU $dnRecoveryKey "MigratedTo"
          WriteRegStr HKCU $dnStateKey "MigratedFrom" $2
          WriteRegStr HKCU $dnStateKey "MigratedTo" $3
          WriteRegStr HKCU $dnStateKey "MigratedAt" $4
          ReadRegStr $0 HKCU $dnStateKey "MigratedAt"
          ${if} $0 != $4
            StrCpy $5 "0"
          ${endif}
        ${endif}
      ${endif}
      ${if} $5 == "1"
        DeleteRegKey HKCU $dnRecoveryKey
      ${else}
        DetailPrint "Kept HKCU\$dnRecoveryKey: the install state could not be written back"
      ${endif}
    ${endif}
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function dnRestoreState
    Call dnRecoverState
    Push $0
    !insertmacro dnRestoreValue $dnJournalKey "Identity" $dnSavedIdentity
    !insertmacro dnRestoreValue $dnJournalKey "SourceDir" $dnSavedSource
    !insertmacro dnRestoreValue $dnJournalKey "DestDir" $dnSavedDest
    !insertmacro dnRestoreValue $dnJournalKey "LegacyUninstallString" $dnSavedUninstall
    !insertmacro dnRestoreValue $dnJournalKey "DesktopLink" $dnSavedDesktop
    !insertmacro dnRestoreValue $dnJournalKey "StartMenuLink" $dnSavedStartMenu
    ; The record is written only as a whole.
    ReadRegStr $0 HKCU $dnStateKey "MigratedTo"
    ${if} $0 == ""
    ${andIf} $dnSavedTo != ""
      WriteRegStr HKCU $dnStateKey "MigratedFrom" $dnSavedFrom
      WriteRegStr HKCU $dnStateKey "MigratedTo" $dnSavedTo
      WriteRegStr HKCU $dnStateKey "MigratedAt" $dnSavedAt
    ${endif}
    Pop $0
  FunctionEnd
!endif
