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
;   3. customInstall verifies the new install, keeps the user's desktop and
;      Start menu shortcut choices (recorded before the old version was touched),
;      repoints taskbar pins that start exactly the old exe (dnRepointPins), then
;      dnFinishMigration checks the old folder again and only then removes it
;      without following links. Only
;      when the old folder is really gone does it write the MigratedFrom /
;      MigratedTo / MigratedAt record (HKCU\Software\${APP_GUID}) that lets the
;      app repoint its login item and MCP client entries.
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
; client configs) on the next launch, only when the record names its own folder:
; src/main/windows-install-migration.ts.
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
  ; Per identity: the journal of a migration in progress, and (in the parent key)
  ; the MigratedFrom/MigratedTo/MigratedAt record of one that was completed.
  !define DN_STATE_KEY "Software\${APP_GUID}"
  !define DN_MIGRATION_KEY "${DN_STATE_KEY}\InstallMigration"
  !define DN_TASKBAR_PINS "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

  Var dnLegacyDir
  ; "1" when the user had the old install's desktop / Start menu shortcut.
  Var dnHadDesktopLink
  Var dnHadStartMenuLink
  ; "1" when the old folder must stay this run (its app could not be closed).
  Var dnKeepLegacy

  ; Exactly what electron-builder registers for a per-user install in DIR.
  !macro dnUninstallCommand DIR OUT
    StrCpy ${OUT} '"${DIR}\${UNINSTALL_FILENAME}" /currentuser'
  !macroend

  !macro customInit
    StrCpy $dnLegacyDir ""
    StrCpy $dnHadDesktopLink "1"
    StrCpy $dnHadStartMenuLink "1"
    StrCpy $dnKeepLegacy "0"
    StrCpy $dnProgramsRoot "$LOCALAPPDATA\Programs"
    StrCpy $dnProfileDir "$APPDATA\${APP_FILENAME}"
    StrCpy $dnJournalKey "${DN_MIGRATION_KEY}"
    StrCpy $dnStateKey "${DN_STATE_KEY}"
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
      ${if} $R6 == ""
        ; Shortcut answers recorded by an untrusted journal are not this move's.
        DeleteRegValue HKCU "${DN_MIGRATION_KEY}" "DesktopLink"
        DeleteRegValue HKCU "${DN_MIGRATION_KEY}" "StartMenuLink"
      ${else}
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
      ; Which shortcuts the user still had, before the old version is touched
      ; (setLinkVars has run: these are the old install's own shortcut paths).
      ; The new install recreates both (keepShortcuts is false: its exe is new),
      ; and customInstall removes again what the user had deleted.
      Push "DesktopLink"
      Push $oldDesktopLink
      Call dnShortcutState
      Pop $dnHadDesktopLink
      Push "StartMenuLink"
      Push $oldStartMenuLink
      Call dnShortcutState
      Pop $dnHadStartMenuLink
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
        ; Keep the user's shortcut choices: what they had deleted stays deleted.
        ${if} $dnHadDesktopLink == "0"
          Delete "$newDesktopLink"
        ${endif}
        ${if} $dnHadStartMenuLink == "0"
          Delete "$newStartMenuLink"
          StrCpy $launchLink "$appExe"
        ${endif}
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
        ; Taskbar pins of any name that start exactly the old exe.
        Push "${DN_TASKBAR_PINS}"
        Push "$dnLegacyDir\${APP_EXECUTABLE_FILENAME}"
        Push "$appExe"
        Call dnRepointPins
        Pop $R8
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
