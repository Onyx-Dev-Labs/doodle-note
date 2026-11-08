; DoodleNote NSIS customisations (electron-builder nsis.include).
;
; Install folder migration. A one-click per-user install is named after the
; package (APP_FILENAME, "desktop"), so earlier builds live in
; %LocalAppData%\Programs\desktop. New installs go to the sibling
; PRODUCT_FILENAME folder ("DoodleNote"). Upgrading an install in the old folder:
;
;   1. customInit (dnPlanMigration, windows-install-guards.nsh) redirects
;      $INSTDIR only when it is exactly <LocalAppData>\Programs\APP_FILENAME
;      after normalising case, separators and short names. It takes that folder
;      for a migration only when dnCheckLegacyDir proves it is the real old
;      install: a real folder holding the old exe, not a junction or link, not
;      resolving onto the new folder or the profile. Anything else, including an
;      install recorded in another folder named APP_FILENAME (an earlier
;      /D=X\desktop), is upgraded in place as before: nothing moved or deleted.
;   2. customCheckAppRunning (dnMigrationClose) closes copies running from
;      exactly the old exe and exactly the new exe, each checked on its own
;      (never electron-builder's path-prefix or image-name matching), then parks
;      the old uninstall command in a journal so electron-builder's "uninstall
;      old version" step cannot delete the old folder before the new one exists.
;   3. customInstall verifies the new install, then dnFinishMigration checks the
;      old folder again and only then removes it without following links.
;
; The journal, HKCU\Software\${APP_GUID}\InstallMigration, belongs to this app
; identity (APP_GUID derives from appId) and records the identity and both
; folders. A later run trusts it (dnTrustedJournal) only when all three still
; match and the old folder passes the same checks; it then finishes an
; interrupted migration. If the app cannot be closed, or which processes are ours
; cannot be established, the new install goes ahead, the old folder stays and the
; journal stays armed.
;
; Shortcut names, appId and so the uninstall registry key are unchanged, so the
; Start menu entry is replaced in place and Apps & features keeps one entry.
; The app profile (%APPDATA%\<package name>: library location, settings,
; accounts) is keyed on the app name, not the folder; the installer never touches
; it. The app repoints references outside the installer's reach (login item, MCP
; client configs) on first launch: src/main/windows-install-migration.ts.
;
; An install with /D=<folder> is left alone.

; electron-builder names the exe ${PRODUCT_FILENAME}.exe (APP_EXECUTABLE_FILENAME,
; defined after this file).
!define DN_APP_EXE "${PRODUCT_FILENAME}.exe"
; What a journal must name to be trusted by this installer.
!define DN_MIGRATION_IDENTITY "${APP_GUID}|${APP_FILENAME}|${PRODUCT_FILENAME}"
!include "${__FILEDIR__}\windows-install-guards.nsh"

; Installer and uninstaller: our own exact-path closer replaces electron-builder's
; _CHECK_APP_RUNNING (it matched every process whose path starts with $INSTDIR, so
; Programs\DoodleNote also matched Programs\DoodleNote QA, and without PowerShell
; it fell back to taskkill by image name). Defining this macro also keeps
; electron-builder from including that code.
!macro customCheckAppRunning
  !insertmacro dnClosePolicy $dnClosePolicy
  !ifdef BUILD_UNINSTALLER
    !insertmacro dnEnsureNotRunning "$INSTDIR"
  !else
    !ifdef DN_MIGRATE_INSTALL_FOLDER
      !insertmacro dnMigrationCheckAppRunning
    !else
      !insertmacro dnEnsureNotRunning "$INSTDIR"
    !endif
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
!if "${APP_FILENAME}" != "${PRODUCT_FILENAME}"
  !define DN_MIGRATE_INSTALL_FOLDER
!endif
!endif

!ifdef DN_MIGRATE_INSTALL_FOLDER
  !define DN_MIGRATION_KEY "Software\${APP_GUID}\InstallMigration"
  !define DN_TASKBAR_PINS "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

  Var dnLegacyDir
  Var dnHadDesktopLink
  ; "1" when the old folder must stay this run (its app could not be closed).
  Var dnKeepLegacy

  ; Exactly what electron-builder registers for a per-user install in DIR.
  !macro dnUninstallCommand DIR OUT
    StrCpy ${OUT} '"${DIR}\${UNINSTALL_FILENAME}" /currentuser'
  !macroend

  !macro customInit
    StrCpy $dnLegacyDir ""
    StrCpy $dnHadDesktopLink "0"
    StrCpy $dnKeepLegacy "0"
    StrCpy $dnProgramsRoot "$LOCALAPPDATA\Programs"
    StrCpy $dnProfileDir "$APPDATA\${APP_FILENAME}"
    StrCpy $dnJournalKey "${DN_MIGRATION_KEY}"
    !insertmacro GetDParameter $R0
    ${if} $R0 == ""
      StrCpy $dnPlanDir "$INSTDIR"
      Call dnPlanMigration
      StrCpy $INSTDIR $dnPlanDir
      StrCpy $dnLegacyDir $dnPlanLegacy
      ${if} $dnPlanNote != ""
        ; Not provably the old install: upgrade in place, exactly as before.
        DetailPrint "Not moving $INSTDIR: $dnPlanNote"
      ${endif}

      ; A previous run that stopped before finishing: trust its journal only for
      ; this identity, this destination and a source that still passes the checks.
      Push "$INSTDIR"
      Call dnTrustedJournal
      Pop $R6
      ${if} $dnPlanNote != ""
        DetailPrint "Ignoring $dnPlanNote"
      ${endif}
      ${if} $R6 != ""
        ${if} $dnLegacyDir == ""
          StrCpy $dnLegacyDir $R6
        ${endif}
        ; Put back a parked uninstall command only if it is exactly the old
        ; folder's own uninstaller and nothing is registered now, so Apps &
        ; features works even if this run is cancelled.
        ${if} $dnLegacyDir == $R6
          ReadRegStr $R7 HKCU "${DN_MIGRATION_KEY}" "LegacyUninstallString"
          ReadRegStr $R8 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
          !insertmacro dnUninstallCommand "$R6" $R9
          ${if} $R7 == $R9
          ${andIf} $R8 == ""
          ${andIf} ${FileExists} "$R6\${UNINSTALL_FILENAME}"
            WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString" $R9
          ${endif}
        ${endif}
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
    WriteRegStr HKCU "${DN_MIGRATION_KEY}" "Identity" "${DN_MIGRATION_IDENTITY}"
    WriteRegStr HKCU "${DN_MIGRATION_KEY}" "SourceDir" $dnLegacyDir
    WriteRegStr HKCU "${DN_MIGRATION_KEY}" "DestDir" $INSTDIR
    ; Park the uninstall command only while it is exactly the old folder's own
    ; uninstaller (after an interrupted run it may already name the new one).
    !insertmacro dnUninstallCommand "$dnLegacyDir" $R9
    ReadRegStr $R6 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ${if} $R6 == $R9
      WriteRegStr HKCU "${DN_MIGRATION_KEY}" "LegacyUninstallString" $R6
      DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ${endif}
    !ifdef UNINSTALL_REGISTRY_KEY_2
      ReadRegStr $R6 HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
      ${if} $R6 == $R9
        DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
      ${endif}
    !endif
    DetailPrint "Moving ${PRODUCT_NAME} from $dnLegacyDir to $INSTDIR"
  !macroend

  !macro dnMigrationCheckAppRunning
    ${if} $dnLegacyDir != ""
      Push $dnLegacyDir
      Push $INSTDIR
      Call dnMigrationClose
      Pop $dnKeepLegacy
      !insertmacro dnParkLegacyUninstaller
    ${else}
      !insertmacro dnEnsureNotRunning "$INSTDIR"
    ${endif}
  !macroend

  !macro customInstall
    ${if} $dnLegacyDir != ""
      ; Verified = the new copy is complete and registered as the uninstall entry.
      ReadRegStr $R7 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      !insertmacro dnUninstallCommand "$INSTDIR" $R9
      ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ${andIf} ${FileExists} "$INSTDIR\resources\app.asar"
      ${andIf} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      ${andIf} $R7 == $R9
        ${if} $dnHadDesktopLink == "0"
          Delete "$newDesktopLink"
        ${endif}
        ${if} ${FileExists} "${DN_TASKBAR_PINS}\${SHORTCUT_NAME}.lnk"
          CreateShortCut "${DN_TASKBAR_PINS}\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
          ClearErrors
          WinShell::SetLnkAUMI "${DN_TASKBAR_PINS}\${SHORTCUT_NAME}.lnk" "${APP_ID}"
        ${endif}
        DeleteRegValue HKCU "${DN_MIGRATION_KEY}" "LegacyUninstallString"
        Push $dnLegacyDir
        Push $INSTDIR
        Push $dnKeepLegacy
        Call dnFinishMigration
        Pop $R8
        ${if} $R8 != "removed"
          DetailPrint "The next install or update retries the move"
        ${endif}
      ${else}
        DetailPrint "The new install in $INSTDIR is incomplete; keeping $dnLegacyDir"
      ${endif}
    ${endif}
  !macroend
!endif
