; Test harness for build/windows-install-guards.nsh, compiled and run by
; scripts/test-windows-installer-guards.cjs (Windows only). Silent: it reads one
; case per line from /cases=<file> and writes "<n>|<result>" lines to /out=<file>.
;
;   root|<programs root>|<profile dir>   sets $dnProgramsRoot / $dnProfileDir
;   check|<old>|<new>                    dnCheckLegacyDir: "" (ok) or the reason
;   remove|<old>                         dnRemoveLegacyDir with <old> itself pinned: removed | kept | unsafe
;   pin|<old>|<new>                      dnPinLegacy: "ok" (then unpinned) or the reason
;   close|<dir>|<policy>                 dnCloseAppIn: none | closed | running | unknown
;   locked|<exe>                         dnExeLocked: 1 | 0
;   canonical|<path>                     dnCanonical: the normalised long path
;   ensure|<dir>                         dnEnsureNotRunning (silent: quits if the app stays running): done
;   plan|<instdir>                       dnPlanMigration: <install dir>|<legacy dir>|<note>
;   jkey|<key>                           sets $dnJournalKey (HKCU, a throwaway test key)
;   arm|<source>|<dest>[|<identity>]     writes a journal as the installer does (default identity: ours)
;   jstate                               armed | none
;   skey|<key>                           sets $dnStateKey (HKCU, a throwaway test key)
;   record                               MigratedFrom|MigratedTo|MigratedAt, or none
;   journal|<dest>                       dnTrustedJournal: the trusted source, or "none: <note>"
;   migclose|<legacy>|<new>|<policy>     dnMigrationClose: KEEP (1 | 0)
;   finish|<legacy>|<new>|<keep>         dnFinishMigration: removed | kept: <why>
;   linkstate|<name>|<path>              dnShortcutState: 1 | 0 (recorded in the journal on first use)
;   pins|<dir>|<old>|<new>               dnRepointPins: number of shortcuts repointed
;   removeat|<dir>|<pin dir>             dnRemoveTreeAt(dir) with <pin dir> held open as the pin: ok | kept | unsafe
;   resolved|<path>                      dnResolved: the path with links resolved
;   ukey|<key>|<key2>                    sets $dnUninstallKey / $dnUninstallKey2 (throwaway HKCU keys; key2 may be empty)
;   ucmd|<command>|<1|2>                 writes UninstallString at key 1 (default) or 2; an empty command deletes it
;   uread                                <key 1 UninstallString>|<key 2 UninstallString>
;   uninstof|<command>                   dnUninstallerDir: the folder, or "none"
;   ucheck|<legacy>|<new>                dnCheckUninstallCommand: ok or the reason
;   park|<legacy>|<new>                  dnParkUninstaller: parked | nothing to park | refused: <why>
;   jread|<value>                        the journal value, or "none"
;   save / restore                       dnSaveState / dnRestoreState: done
;   rkey|<key>                           sets $dnRecoveryKey (HKCU, a throwaway test key)
;   recover                              dnRecoverState (what customInit runs first): done
;   rstate                               present (the recovery key names an identity) | none
;   rread|<value> / rwrite|<value>|<data> reads ("none" when empty) / writes a recovery key value (data: the rest of the line)
;   kill                                 terminates this process at once (an installer that dies)
;   wipe                                 deletes $dnStateKey with its journal subkey, as electron-builder's uninstaller does
;   unlegacy|<dest>|<policy>             dnUninstallLegacy: none | removed | kept: <why>
Unicode true
SilentInstall silent
RequestExecutionLevel user
OutFile "${OUT_FILE}"

!define PRODUCT_NAME "DoodleNote test"
!define DN_WITH_UNINSTALL_LEGACY
!macro _isUpdated _a _b _t _f
  StrCmp "" "1" `${_t}` `${_f}`
!macroend
!define isUpdated `"" isUpdated ""`

LoadLanguageFile "${NSISDIR}\Contrib\Language files\English.nlf"
LangString appRunning ${LANG_ENGLISH} "running"
LangString appClosing ${LANG_ENGLISH} "closing"
LangString appCannotBeClosed ${LANG_ENGLISH} "cannot be closed"

!include "${GUARDS}"

Var cases
Var out
Var line
Var n
Var kind
Var a
Var b
Var c
Var result
Var pin

Section
SectionEnd

; Splits $line at the first "|": $kind gets the head, $line the rest.
!macro next_field OUTVAR
  StrCpy ${OUTVAR} ""
  ${do}
    StrCpy $0 $line 1
    StrCpy $line $line "" 1
    ${if} $0 == "|"
    ${orIf} $0 == ""
      ${break}
    ${endif}
    StrCpy ${OUTVAR} "${OUTVAR}$0"
  ${loop}
!macroend

Function .onInit
  ${GetParameters} $0
  ${GetOptions} $0 "/cases=" $1
  ${GetOptions} $0 "/out=" $2
  FileOpen $cases $1 r
  FileOpen $out $2 w
  StrCpy $n 0
  ${do}
    ClearErrors
    FileReadUTF16LE $cases $line
    ${if} ${Errors}
      ${break}
    ${endif}
    ; Drop the line ending.
    ${do}
      StrCpy $0 $line 1 -1
      ${if} $0 != "$\r"
      ${andIf} $0 != "$\n"
        ${break}
      ${endif}
      StrCpy $line $line -1
    ${loop}
    IntOp $n $n + 1
    !insertmacro next_field $kind
    !insertmacro next_field $a
    !insertmacro next_field $b
    !insertmacro next_field $c
    StrCpy $result "?"
    ${if} $kind == "root"
      StrCpy $dnProgramsRoot $a
      StrCpy $dnProfileDir $b
      StrCpy $result "set"
    ${elseif} $kind == "check"
      Push $a
      Push $b
      Call dnCheckLegacyDir
      Pop $result
      ${if} $result == ""
        StrCpy $result "ok"
      ${endif}
    ${elseif} $kind == "remove"
      ; The deleter alone: pin the folder as dnPinLegacy would, without its checks.
      Push $a
      Push ${DN_ACCESS_DELETE}
      Push 3
      Call dnOpenNoFollow
      Pop $dnPinRoot
      Push $a
      Call dnRemoveLegacyDir
      Pop $result
      Call dnUnpin
    ${elseif} $kind == "pin"
      Push $a
      Push $b
      Call dnPinLegacy
      Pop $result
      ${if} $result == ""
        StrCpy $result "ok"
      ${endif}
      Call dnUnpin
    ${elseif} $kind == "close"
      StrCpy $dnClosePolicy $b
      !insertmacro dnCloseAppIn $a $dnClosePolicy $result
    ${elseif} $kind == "locked"
      !insertmacro dnExeLocked $a $result
    ${elseif} $kind == "canonical"
      Push $a
      Call dnCanonical
      Pop $result
    ${elseif} $kind == "ensure"
      StrCpy $dnClosePolicy "never"
      !insertmacro dnEnsureNotRunning $a
      StrCpy $result "done"
    ${elseif} $kind == "plan"
      StrCpy $dnPlanDir $a
      Call dnPlanMigration
      StrCpy $result "$dnPlanDir|$dnPlanLegacy|$dnPlanNote"
    ${elseif} $kind == "jkey"
      StrCpy $dnJournalKey $a
      StrCpy $result "set"
    ${elseif} $kind == "arm"
      ${if} $c == ""
        StrCpy $c "${DN_MIGRATION_IDENTITY}"
      ${endif}
      WriteRegStr HKCU $dnJournalKey "Identity" $c
      WriteRegStr HKCU $dnJournalKey "SourceDir" $a
      WriteRegStr HKCU $dnJournalKey "DestDir" $b
      StrCpy $result "armed"
    ${elseif} $kind == "skey"
      StrCpy $dnStateKey $a
      StrCpy $result "set"
    ${elseif} $kind == "record"
      ReadRegStr $0 HKCU $dnStateKey "MigratedFrom"
      ReadRegStr $1 HKCU $dnStateKey "MigratedTo"
      ReadRegStr $2 HKCU $dnStateKey "MigratedAt"
      StrCpy $result "$0|$1|$2"
      ${if} $result == "||"
        StrCpy $result "none"
      ${endif}
    ${elseif} $kind == "jstate"
      ReadRegStr $result HKCU $dnJournalKey "Identity"
      ${if} $result == ""
        StrCpy $result "none"
      ${else}
        StrCpy $result "armed"
      ${endif}
    ${elseif} $kind == "journal"
      Push $a
      Call dnTrustedJournal
      Pop $result
      ${if} $result == ""
        StrCpy $result "none: $dnPlanNote"
      ${endif}
    ${elseif} $kind == "migclose"
      StrCpy $dnClosePolicy $c
      Push $a
      Push $b
      Call dnMigrationClose
      Pop $result
    ${elseif} $kind == "linkstate"
      Push $a
      Push $b
      Call dnShortcutState
      Pop $result
    ${elseif} $kind == "pins"
      Push $a
      Push $b
      Push $c
      Call dnRepointPins
      Pop $result
    ${elseif} $kind == "removeat"
      Push $b
      Push ${DN_ACCESS_DELETE}
      Push 3
      Call dnOpenNoFollow
      Pop $pin
      ${if} $pin = 0
        StrCpy $result "pin failed"
      ${else}
        Push $a
        Push $pin
        Push ""
        Call dnRemoveTreeAt
        Pop $result
        System::Call 'kernel32::CloseHandle(p $pin)'
      ${endif}
    ${elseif} $kind == "resolved"
      Push $a
      Call dnResolved
      Pop $result
    ${elseif} $kind == "ukey"
      StrCpy $dnUninstallKey $a
      StrCpy $dnUninstallKey2 $b
      StrCpy $result "set"
    ${elseif} $kind == "ucmd"
      StrCpy $0 $dnUninstallKey
      ${if} $b == "2"
        StrCpy $0 $dnUninstallKey2
      ${endif}
      ${if} $a == ""
        DeleteRegValue HKCU $0 "UninstallString"
      ${else}
        WriteRegStr HKCU $0 "UninstallString" $a
      ${endif}
      StrCpy $result "set"
    ${elseif} $kind == "uread"
      ReadRegStr $0 HKCU $dnUninstallKey "UninstallString"
      StrCpy $1 ""
      ${if} $dnUninstallKey2 != ""
        ReadRegStr $1 HKCU $dnUninstallKey2 "UninstallString"
      ${endif}
      StrCpy $result "$0|$1"
    ${elseif} $kind == "uninstof"
      Push $a
      Call dnUninstallerDir
      Pop $result
      ${if} $result == ""
        StrCpy $result "none"
      ${endif}
    ${elseif} $kind == "ucheck"
      Push $a
      Push $b
      Call dnCheckUninstallCommand
      Pop $result
      ${if} $result == ""
        StrCpy $result "ok"
      ${endif}
    ${elseif} $kind == "park"
      Push $a
      Push $b
      Call dnParkUninstaller
      Pop $result
    ${elseif} $kind == "jread"
      ReadRegStr $result HKCU $dnJournalKey $a
      ${if} $result == ""
        StrCpy $result "none"
      ${endif}
    ${elseif} $kind == "save"
      Call dnSaveState
      StrCpy $result "done"
    ${elseif} $kind == "restore"
      Call dnRestoreState
      StrCpy $result "done"
    ${elseif} $kind == "rkey"
      StrCpy $dnRecoveryKey $a
      StrCpy $result "set"
    ${elseif} $kind == "recover"
      Call dnRecoverState
      StrCpy $result "done"
    ${elseif} $kind == "rstate"
      ReadRegStr $result HKCU $dnRecoveryKey "RecoveryFor"
      ${if} $result == ""
        StrCpy $result "none"
      ${else}
        StrCpy $result "present"
      ${endif}
    ${elseif} $kind == "rread"
      ReadRegStr $result HKCU $dnRecoveryKey $a
      ${if} $result == ""
        StrCpy $result "none"
      ${endif}
    ${elseif} $kind == "rwrite"
      ; The data is the rest of the line ("|" included: identities contain it).
      StrCpy $0 $b
      ${if} $c != ""
      ${orIf} $line != ""
        StrCpy $0 "$0|$c"
      ${endif}
      ${if} $line != ""
        StrCpy $0 "$0|$line"
      ${endif}
      WriteRegStr HKCU $dnRecoveryKey $a $0
      StrCpy $result "set"
    ${elseif} $kind == "kill"
      FileClose $out
      System::Call 'kernel32::GetCurrentProcess() p.r0'
      System::Call 'kernel32::TerminateProcess(p r0, i 9)'
    ${elseif} $kind == "wipe"
      DeleteRegKey HKCU $dnStateKey
      StrCpy $result "done"
    ${elseif} $kind == "unlegacy"
      StrCpy $dnClosePolicy $b
      Push $a
      Call dnUninstallLegacy
      Pop $result
    ${elseif} $kind == "finish"
      Push $a
      Push $b
      Push $c
      Call dnFinishMigration
      Pop $result
    ${endif}
    FileWriteUTF16LE $out "$n|$result$\r$\n"
  ${loop}
  FileClose $cases
  FileClose $out
  SetErrorLevel 0
  Quit
FunctionEnd
