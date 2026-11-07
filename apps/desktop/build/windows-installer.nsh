; DoodleNote NSIS customisations (electron-builder nsis.include).
;
; Install folder migration. A one-click per-user install is named after the
; package ("desktop"), so earlier builds live in <UserProgramFiles>\desktop
; (normally %LocalAppData%\Programs\desktop). New installs go to
; <UserProgramFiles>\DoodleNote. Upgrading an install in the old folder:
;
;   1. customInit points $INSTDIR at the sibling DoodleNote folder.
;   2. customCheckAppRunning also closes copies running from the old folder,
;      then parks the old uninstall command so electron-builder's "uninstall
;      old version" step cannot delete the old folder before the new one exists.
;   3. customInstall verifies the new install and only then removes the old
;      folder, keeps the user's desktop-shortcut choice and repoints a taskbar pin.
;
; Shortcut names, appId and so the uninstall registry key are unchanged, so the
; Start menu entry is replaced in place and Apps & features keeps one entry.
; The app profile (%APPDATA%\desktop: library location, settings, accounts) is
; keyed on the app name, not the folder; the installer never touches it. The
; app repoints references outside the installer's reach (login item, MCP client
; configs) on first launch: src/main/windows-install-migration.ts.
;
; An install with /D=<folder>, or in a folder not named "desktop", is left alone.

!ifndef BUILD_UNINSTALLER
!if "${APP_FILENAME}" != "${PRODUCT_FILENAME}"
  !define DN_MIGRATE_INSTALL_FOLDER
!endif
!endif

!ifdef DN_MIGRATE_INSTALL_FOLDER
  ; Journal of a migration in progress, so an interrupted run is finished by the next one.
  !define DN_MIGRATION_KEY "Software\DoodleNote\InstallMigration"
  !define DN_TASKBAR_PINS "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

  ; Defining customCheckAppRunning makes electron-builder skip these two.
  !include "getProcessInfo.nsh"
  Var pid

  Var dnLegacyDir
  Var dnNewDir
  Var dnHadDesktopLink

  !macro customInit
    StrCpy $dnLegacyDir ""
    StrCpy $dnHadDesktopLink "0"
    !insertmacro GetDParameter $R0
    ${if} $R0 == ""
      ${GetFileName} "$INSTDIR" $R1
      ${if} $R1 == "${APP_FILENAME}"
        ${GetParent} "$INSTDIR" $R2
        ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
          StrCpy $dnLegacyDir "$INSTDIR"
        ${endif}
        StrCpy $INSTDIR "$R2\${PRODUCT_FILENAME}"
      ${endif}
    ${endif}

    ; A previous run parked the old uninstall command and then stopped before the
    ; new install registered itself: put the command back so Apps & features
    ; works, and finish the migration in this run.
    ReadRegStr $R3 HKCU "${DN_MIGRATION_KEY}" "LegacyInstallLocation"
    ReadRegStr $R4 HKCU "${DN_MIGRATION_KEY}" "LegacyUninstallString"
    ReadRegStr $R5 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ${if} $R4 != ""
    ${andIf} $R5 == ""
      WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString" $R4
    ${endif}
    ${if} $dnLegacyDir == ""
    ${andIf} $R3 != ""
    ${andIf} $R0 == ""
      ; Only the folder this journal recorded, and only while something is left of it.
      ${GetFileName} "$R3" $R1
      ${if} $R1 == "${APP_FILENAME}"
      ${andIf} $R3 != $INSTDIR
      ${andIf} ${FileExists} "$R3\*.*"
        StrCpy $dnLegacyDir $R3
      ${endif}
    ${endif}

    ${if} $dnLegacyDir != ""
      ; Respect a user who deleted the desktop shortcut of the old install.
      ${if} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
        StrCpy $dnHadDesktopLink "1"
      ${endif}
    ${endif}
  !macroend

  !macro dnParkLegacyUninstaller
    WriteRegStr HKCU "${DN_MIGRATION_KEY}" "LegacyInstallLocation" $dnLegacyDir
    ; Park the uninstall command only while it still runs the old folder's
    ; uninstaller (a retry after a completed install already points at the new one).
    ReadRegStr $R6 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    StrCpy $R8 '"$dnLegacyDir\'
    StrLen $R9 $R8
    StrCpy $R9 $R6 $R9
    ${if} $R9 == $R8
      WriteRegStr HKCU "${DN_MIGRATION_KEY}" "LegacyUninstallString" $R6
      DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      !ifdef UNINSTALL_REGISTRY_KEY_2
        DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
      !endif
    ${endif}
    DetailPrint "Moving DoodleNote from $dnLegacyDir to $INSTDIR"
  !macroend

  !macro customCheckAppRunning
    ; The stock check finds running copies by path prefix ($INSTDIR); during a
    ; migration the running copy is in the old folder.
    StrCpy $dnNewDir $INSTDIR
    ${if} $dnLegacyDir != ""
    ${andIf} ${FileExists} "$dnLegacyDir\${APP_EXECUTABLE_FILENAME}"
    ${andIfNot} ${FileExists} "$dnNewDir\${APP_EXECUTABLE_FILENAME}"
      StrCpy $INSTDIR $dnLegacyDir
    ${endif}
    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
    StrCpy $INSTDIR $dnNewDir
    ${if} $dnLegacyDir != ""
      !insertmacro dnParkLegacyUninstaller
    ${endif}
  !macroend

  !macro customInstall
    ${if} $dnLegacyDir != ""
      ; Verified = the new copy is complete and registered as the uninstall entry.
      ReadRegStr $R7 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ${andIf} ${FileExists} "$INSTDIR\resources\app.asar"
      ${andIf} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      ${andIf} $R7 == '"$INSTDIR\${UNINSTALL_FILENAME}" /currentuser'
      ${andIf} $dnLegacyDir != $INSTDIR
        ${if} $dnHadDesktopLink == "0"
          Delete "$newDesktopLink"
        ${endif}
        ${if} ${FileExists} "${DN_TASKBAR_PINS}\${SHORTCUT_NAME}.lnk"
          CreateShortCut "${DN_TASKBAR_PINS}\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
          ClearErrors
          WinShell::SetLnkAUMI "${DN_TASKBAR_PINS}\${SHORTCUT_NAME}.lnk" "${APP_ID}"
        ${endif}
        DeleteRegValue HKCU "${DN_MIGRATION_KEY}" "LegacyUninstallString"
        RMDir /r "$dnLegacyDir"
        ${if} ${FileExists} "$dnLegacyDir\*.*"
          ; Something still holds a file; the next install or update retries.
          DetailPrint "Could not remove all of $dnLegacyDir; it will be retried"
        ${else}
          DeleteRegKey HKCU "${DN_MIGRATION_KEY}"
          DeleteRegKey /ifempty HKCU "Software\DoodleNote"
        ${endif}
      ${else}
        DetailPrint "The new install in $INSTDIR is incomplete; keeping $dnLegacyDir"
      ${endif}
    ${endif}
  !macroend
!endif
