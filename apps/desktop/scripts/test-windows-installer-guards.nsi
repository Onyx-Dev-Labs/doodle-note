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
    ${endif}
    FileWriteUTF16LE $out "$n|$result$\r$\n"
  ${loop}
  FileClose $cases
  FileClose $out
  SetErrorLevel 0
  Quit
FunctionEnd
