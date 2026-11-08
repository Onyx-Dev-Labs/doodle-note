; TEST ONLY: the QA installer of the CI end-to-end job's interrupted-upgrade case
; (scripts/test-windows-installer-e2e.cjs). It is only ever passed as
; -c.nsis.include to a --prepackaged QA build; electron-builder.yml and
; electron-builder.qa.cjs include windows-installer.nsh (release-packaging.test.ts).
; DN_TEST_STEPS arms the dnTestStep kill points: with DN_TEST_STOP_AT=<step> in its
; environment the installer terminates itself right there (exit code 9), as a crash
; or a power cut would. Two installer-level points:
;   after-uninstall-old-version  right after electron-builder's uninstallOldVersion
;                                returns (customUnInstallCheck): the stock uninstaller has
;                                just run, deleted Software\{APP_GUID} (journal and record),
;                                and nothing is restored or copied yet (scenario D);
;   after-stock-uninstall        right before customInstall: after the file copy, the
;                                uninstall entry and the shortcuts (scenario B).
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

; electron-builder's handleUninstallResult (installUtil.nsh, 26.15.3) runs this right
; after uninstallOldVersion and then returns, so the stock result check that follows
; it there is repeated here exactly (pinned, release-packaging.test.ts), with the kill
; point first and the error flag carried across it.
!macro customUnInstallCheck
  !ifndef BUILD_UNINSTALLER
    Push $R1
    StrCpy $R1 "0"
    IfErrors 0 +2
      StrCpy $R1 "1"
    ReadEnvStr $dnTestStopAt DN_TEST_STOP_AT
    !insertmacro dnTestStep "after-uninstall-old-version"
    ClearErrors
    ${if} $R1 == "1"
      SetErrors
    ${endif}
    Pop $R1
  !endif
  IfErrors 0 +3
  DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  Return

  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}
!macroend
