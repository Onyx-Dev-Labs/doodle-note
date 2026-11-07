; Guards for the install folder migration in windows-installer.nsh, kept in their
; own file so scripts/test-windows-installer-guards.cjs can compile them into a
; test harness and check them against real folders, links and processes.
;
; Needs these defines: APP_FILENAME (the old folder name, the package name),
; PRODUCT_FILENAME (the new folder name) and DN_APP_EXE (the app's exe name in
; both; electron-builder's APP_EXECUTABLE_FILENAME is defined only after this
; file is compiled). The installer and the harness set $dnProgramsRoot and
; $dnProfileDir before calling dnCheckLegacyDir.

!include LogicLib.nsh
!include FileFunc.nsh

!define DN_ATTR_DIRECTORY 0x10
!define DN_ATTR_REPARSE_POINT 0x400
!define DN_POWERSHELL "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"

; Finds the processes whose executable is exactly $env:DN_CLOSE_EXE (full path,
; case-insensitive; no prefix or image-name matching) through Win32_Process,
; which works from the 32-bit installer. Exit 0: none (left) running. Exit 10:
; some still running (DN_CLOSE_MODE=find, or they survived closing). Any other
; exit: identity could not be established (no PowerShell or CIM, or a process
; with this image name in this session whose path cannot be read). With
; DN_CLOSE_MODE=close it asks each one to close (CloseMainWindow), waits up to
; 5 s, then stops only the PIDs that still match, and waits up to 5 s more.
; Paths reach the script through the environment, never through its text.
!define DN_CLOSE_PS `$$ErrorActionPreference='Stop'; try { $$want = [IO.Path]::GetFullPath($$env:DN_CLOSE_EXE); $$name = [IO.Path]::GetFileName($$want); $$session = (Get-Process -Id $$PID).SessionId; function ours { $$o = @(); foreach ($$p in @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.Name -eq $$name })) { if (-not $$p.ExecutablePath) { if ($$p.SessionId -eq $$session) { throw 'unreadable' }; continue }; if ([IO.Path]::GetFullPath($$p.ExecutablePath) -eq $$want) { $$o += [int]$$p.ProcessId } }; ,$$o }; $$ids = ours; if ($$ids.Count -eq 0) { exit 0 }; if ($$env:DN_CLOSE_MODE -ne 'close') { exit 10 }; foreach ($$i in $$ids) { try { [void](Get-Process -Id $$i).CloseMainWindow() } catch { } }; for ($$t = 0; $$t -lt 20 -and (ours).Count; $$t++) { Start-Sleep -Milliseconds 250 }; foreach ($$i in (ours)) { Stop-Process -Id $$i -Force -ErrorAction SilentlyContinue }; for ($$t = 0; $$t -lt 20 -and (ours).Count; $$t++) { Start-Sleep -Milliseconds 250 }; if ((ours).Count) { exit 10 }; exit 0 } catch { exit 3 }`

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
; (identity could not be established) or cancel (the user said no).
!macro dnCloseAppIn DIR POLICY RESULT
  System::Call 'kernel32::SetEnvironmentVariableW(w "DN_CLOSE_EXE", w "${DIR}\${DN_APP_EXE}")'
  System::Call 'kernel32::SetEnvironmentVariableW(w "DN_CLOSE_MODE", w "find")'
  nsExec::Exec `"${DN_POWERSHELL}" -NoProfile -NonInteractive -Command "${DN_CLOSE_PS}"`
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
      nsExec::Exec `"${DN_POWERSHELL}" -NoProfile -NonInteractive -Command "${DN_CLOSE_PS}"`
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

!ifndef BUILD_UNINSTALLER
  Var dnProgramsRoot
  Var dnProfileDir

  ; Push PATH; Call dnCanonical; Pop RESULT: absolute, long-name form without a
  ; trailing separator ("" when the path is not valid). Links are not resolved.
  Function dnCanonical
    Exch $0
    Push $1
    Push $2
    StrCpy $1 ""
    ${if} $0 != ""
      System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r2'
      ${if} $2 = 0
      ${orIf} $2 >= ${NSIS_MAX_STRLEN}
        StrCpy $1 ""
      ${else}
        System::Call 'kernel32::GetLongPathNameW(w r1, w .r0, i ${NSIS_MAX_STRLEN}) i.r2'
        ${if} $2 <> 0
        ${andIf} $2 < ${NSIS_MAX_STRLEN}
          StrCpy $1 $0
        ${endif}
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
      ${endif}
    ${endif}
    StrCpy $0 $1
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  ; Push PATH; Call dnAttributes; Pop ATTRIBUTES (-1 when missing).
  Function dnAttributes
    Exch $0
    System::Call 'kernel32::GetFileAttributesW(w r0) i.r0'
    Exch $0
  FunctionEnd

  ; Push PATH; Call dnFinalPath; Pop FINAL: the path with every junction and
  ; symbolic link resolved, as Windows itself opens it ("" when it cannot be opened).
  Function dnFinalPath
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

  ; Push A; Push B; Call dnOverlaps; Pop 1 when A and B are the same folder or
  ; one is inside the other (case-insensitive, separator-bounded), else 0.
  Function dnOverlaps
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
  ; neither may overlap the app profile.
  Function dnCheckLegacyDir
    Exch $1
    Exch
    Exch $0
    Push $2
    Push $3
    Push $4
    Push $5
    StrCpy $5 ""
    Push $0
    Call dnCanonical
    Pop $0
    Push $1
    Call dnCanonical
    Pop $1
    Push $dnProgramsRoot
    Call dnCanonical
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
      Call dnOverlaps
      Pop $3
      ${if} $3 == "1"
        StrCpy $5 "the old and new folders overlap"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $dnProfileDir
      Call dnCanonical
      Pop $3
      ${if} $3 == ""
        StrCpy $5 "the profile path is not valid"
      ${else}
        Push $0
        Push $3
        Call dnOverlaps
        Pop $4
        Push $1
        Push $3
        Call dnOverlaps
        Pop $3
        ${if} $4 == "1"
        ${orIf} $3 == "1"
          StrCpy $5 "a folder overlaps the app profile"
        ${endif}
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $0
      Call dnAttributes
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
      Call dnAttributes
      Pop $3
      IntOp $4 $3 & 0x410
      ${if} $3 = -1
      ${orIf} $4 <> 0
        StrCpy $5 "the old folder has no ${DN_APP_EXE}"
      ${endif}
    ${endif}
    ${if} $5 == ""
      Push $1
      Call dnAttributes
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
      Call dnFinalPath
      Pop $2
      Push $0
      Call dnFinalPath
      Pop $3
      ${if} $2 == ""
      ${orIf} $3 == ""
        StrCpy $5 "a folder cannot be opened"
      ${elseif} $3 != "$2\${APP_FILENAME}"
        StrCpy $5 "the old folder resolves to $3"
      ${else}
        Push $1
        Call dnAttributes
        Pop $4
        ${if} $4 <> -1
          Push $1
          Call dnFinalPath
          Pop $4
          ${if} $4 == ""
            StrCpy $5 "the new folder cannot be opened"
          ${else}
            Push $3
            Push $4
            Call dnOverlaps
            Pop $4
            ${if} $4 == "1"
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

  ; Push DIR; Call dnRemoveTree: deletes DIR and everything in it without ever
  ; entering a junction or symbolic link (NSIS's RMDir /r follows them and would
  ; delete the target's contents); a link is removed, never what it points to.
  ; Files that cannot be deleted stay; the caller checks what is left.
  Function dnRemoveTree
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    ClearErrors
    FindFirst $1 $2 "$0\*.*"
    ${doWhile} $2 != ""
      ${if} $2 != "."
      ${andIf} $2 != ".."
        Push "$0\$2"
        Call dnAttributes
        Pop $3
        ${if} $3 <> -1
          IntOp $4 $3 & ${DN_ATTR_REPARSE_POINT}
          ${if} $4 <> 0
            IntOp $4 $3 & ${DN_ATTR_DIRECTORY}
            ${if} $4 <> 0
              RMDir "$0\$2"
            ${else}
              Delete "$0\$2"
            ${endif}
          ${else}
            IntOp $4 $3 & ${DN_ATTR_DIRECTORY}
            ${if} $4 <> 0
              Push "$0\$2"
              Call dnRemoveTree
            ${else}
              Delete "$0\$2"
            ${endif}
          ${endif}
        ${endif}
      ${endif}
      ClearErrors
      FindNext $1 $2
    ${loop}
    FindClose $1
    RMDir "$0"
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  ; Push DIR; Call dnRemoveLegacyDir; Pop "removed" or "kept". Removes everything
  ; but DN_APP_EXE first and the exe last, so a folder that is only
  ; partly removed (a file was held) still holds the exe, and the next run's
  ; dnCheckLegacyDir still recognises it as the old install.
  Function dnRemoveLegacyDir
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    ClearErrors
    FindFirst $1 $2 "$0\*.*"
    ${doWhile} $2 != ""
      ${if} $2 != "."
      ${andIf} $2 != ".."
      ${andIf} $2 != "${DN_APP_EXE}"
        Push "$0\$2"
        Call dnAttributes
        Pop $3
        ${if} $3 <> -1
          IntOp $4 $3 & ${DN_ATTR_REPARSE_POINT}
          ${if} $4 <> 0
            IntOp $4 $3 & ${DN_ATTR_DIRECTORY}
            ${if} $4 <> 0
              RMDir "$0\$2"
            ${else}
              Delete "$0\$2"
            ${endif}
          ${else}
            IntOp $4 $3 & ${DN_ATTR_DIRECTORY}
            ${if} $4 <> 0
              Push "$0\$2"
              Call dnRemoveTree
            ${else}
              Delete "$0\$2"
            ${endif}
          ${endif}
        ${endif}
      ${endif}
      ClearErrors
      FindNext $1 $2
    ${loop}
    FindClose $1
    ; Anything left besides the exe?
    StrCpy $3 "0"
    ClearErrors
    FindFirst $1 $2 "$0\*.*"
    ${doWhile} $2 != ""
      ${if} $2 != "."
      ${andIf} $2 != ".."
      ${andIf} $2 != "${DN_APP_EXE}"
        StrCpy $3 "1"
      ${endif}
      ClearErrors
      FindNext $1 $2
    ${loop}
    FindClose $1
    ${if} $3 == "0"
      Delete "$0\${DN_APP_EXE}"
      RMDir "$0"
    ${endif}
    ${if} ${FileExists} "$0\*.*"
      StrCpy $0 "kept"
    ${else}
      StrCpy $0 "removed"
    ${endif}
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd
!endif
