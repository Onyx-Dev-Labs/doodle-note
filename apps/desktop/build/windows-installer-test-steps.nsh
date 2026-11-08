; TEST ONLY: the QA installer of the CI end-to-end job's interrupted-upgrade case
; (scripts/test-windows-installer-e2e.cjs). It is only ever passed as
; -c.nsis.include to a --prepackaged QA build; electron-builder.yml and
; electron-builder.qa.cjs include windows-installer.nsh (release-packaging.test.ts).
; DN_TEST_STEPS arms the dnTestStep kill points: with DN_TEST_STOP_AT=<step> in its
; environment the installer terminates itself right there (exit code 9), as a crash
; or a power cut would.
; Installer only: the uninstaller half has no kill point (and an unused variable
; would fail electron-builder's -WX).
!ifndef BUILD_UNINSTALLER
  !define DN_TEST_STEPS
!endif
!include "${__FILEDIR__}\windows-installer.nsh"

; electron-builder's installSection.nsh runs this right before customInstall: after
; "uninstall old version", the file copy, the uninstall entry and the shortcuts.
; This app registers no file associations, so nothing else defines it.
!macro registerFileAssociations
  ReadEnvStr $dnTestStopAt DN_TEST_STOP_AT
  !insertmacro dnTestStep "after-stock-uninstall"
!macroend
