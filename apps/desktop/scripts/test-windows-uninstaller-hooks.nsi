; Harness for the uninstaller's earliest exits, compiled and run by
; scripts/test-windows-installer-guards.cjs (Windows only). It includes the real
; build/windows-installer.nsh (and so the guards) as an uninstaller build and calls
; its hooks in the order electron-builder 26.15.3's templates/nsis/uninstaller.nsh
; does (release-packaging.test.ts pins that order there and here):
;
;   un.onInit: parse /S (SetSilent), call un.checkAppRunning (customCheckAppRunning),
;              then customUnInit
;   un.<section>: customUnInstall
;
; Compiled as an installer, it only writes the uninstaller to UNINSTALLER_OUT and
; quits, as electron-builder's BUILD_UNINSTALLER pass does. Run the uninstaller with
; _?=<its folder> so it runs in place and its exit code is the test's.
;
;   /S      a silent uninstall (the app running: exit code 2, recorded)
;   /ask    test builds only: silent, but with the "ask" close policy whose prompt
;           answers Cancel by itself (DN_TEST_ASK_CANCEL): a user who clicked Cancel
Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${OUT_FILE}"

!define BUILD_UNINSTALLER
!define DN_TEST_ASK_CANCEL
!macro _isUpdated _a _b _t _f
  StrCmp "" "1" `${_t}` `${_f}`
!macroend
!define isUpdated `"" isUpdated ""`

LoadLanguageFile "${NSISDIR}\Contrib\Language files\English.nlf"
LangString appRunning ${LANG_ENGLISH} "running"
LangString appClosing ${LANG_ENGLISH} "closing"
LangString appCannotBeClosed ${LANG_ENGLISH} "cannot be closed"

!include "${INSTALLER_NSH}"

Function .onInit
  WriteUninstaller "${UNINSTALLER_OUT}"
  ; electron-builder's quitSuccess: a bare Quit from .onInit exits with 2.
  SetErrorLevel 0
  Quit
FunctionEnd

Section
SectionEnd

Function un.checkAppRunning
  !insertmacro customCheckAppRunning
FunctionEnd

Function un.onInit
  StrCpy $dnTestAsk "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/ask" $R1
  ${IfNot} ${Errors}
    StrCpy $dnTestAsk "1"
    SetSilent silent
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/S" $R1
  ${IfNot} ${Errors}
    SetSilent silent
  ${EndIf}
  ; electron-builder: ${If} ${Silent} call un.checkAppRunning, else (one-click) its
  ; "are you sure?" box, then call un.checkAppRunning; then initMultiUser and
  ; customUnInit. This harness always runs silently.
  call un.checkAppRunning
  !insertmacro customUnInit
FunctionEnd

Section "un.Uninstall"
  !insertmacro customUnInstall
SectionEnd
