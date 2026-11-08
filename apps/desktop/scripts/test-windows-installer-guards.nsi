; Test harness for build/windows-install-guards.nsh, compiled and run by
; scripts/test-windows-installer-guards.cjs (Windows only). Silent: it reads one
; case per line from /cases=<file> and writes "<n>|<result>" lines to /out=<file>.
;
;   root|<programs root>|<profile dir>   sets $dnProgramsRoot / $dnProfileDir
;   check|<old>|<new>                    dnCheckLegacyDir: "" (ok) or the reason
;   remove|<old>                         dnRemoveLegacyDir: removed | kept
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
Unicode true
SilentInstall silent
RequestExecutionLevel user
OutFile "${OUT_FILE}"

!define PRODUCT_NAME "DoodleNote test"
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
      Push $a
      Call dnRemoveLegacyDir
      Pop $result
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
