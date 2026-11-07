; DoodleNote NSIS customisations (electron-builder nsis.include).
;
; Install folder migration. A one-click per-user install is named after the
; package (APP_FILENAME, "desktop"), so earlier builds live in
; %LocalAppData%\Programs\desktop. New installs go to the sibling
; PRODUCT_FILENAME folder ("DoodleNote"). Upgrading an install in the old folder:
;
;   1. customInit points $INSTDIR at the new folder, but takes the old folder for
;      a migration only when dnCheckLegacyDir (windows-install-guards.nsh) proves
;      it is the real old install: exactly <LocalAppData>\Programs\APP_FILENAME, a
;      real folder holding the old exe, not a junction or link, not resolving onto
;      the new folder or the profile. Anything else is upgraded in place as before.
;   2. customCheckAppRunning closes copies running from exactly the old exe and
;      exactly the new exe, each checked on its own (never electron-builder's
;      path-prefix or image-name matching), then parks the old uninstall command
;      in a journal so electron-builder's "uninstall old version" step cannot
;      delete the old folder before the new one exists.
;   3. customInstall verifies the new install, checks the old folder again, and
;      only then removes it without following links, keeps the user's
;      desktop-shortcut choice and repoints a taskbar pin.
;
; The journal, HKCU\Software\${APP_GUID}\InstallMigration, belongs to this app
; identity (APP_GUID derives from appId) and records the identity and both
; folders. A later run trusts it only when all three still match and the old
; folder passes the same checks; it then finishes an interrupted migration. If
; the app cannot be closed, or which processes are ours cannot be established,
; the new install goes ahead, the old folder stays and the journal stays armed.
;
; Shortcut names, appId and so the uninstall registry key are unchanged, so the
; Start menu entry is replaced in place and Apps & features keeps one entry.
; The app profile (%APPDATA%\<package name>: library location, settings,
; accounts) is keyed on the app name, not the folder; the installer never touches
; it. The app repoints references outside the installer's reach (login item, MCP
; client configs) on first launch: src/main/windows-install-migration.ts.
;
; An install with /D=<folder>, or in a folder not named APP_FILENAME, is left alone.

; electron-builder names the exe ${PRODUCT_FILENAME}.exe (APP_EXECUTABLE_FILENAME,
; defined after this file).
!define DN_APP_EXE "${PRODUCT_FILENAME}.exe"
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
  ; What a journal must name to be trusted by this installer.
  !define DN_MIGRATION_IDENTITY "${APP_GUID}|${APP_FILENAME}|${PRODUCT_FILENAME}"
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
    !insertmacro GetDParameter $R0
    ${if} $R0 == ""
      ${GetFileName} "$INSTDIR" $R1
      ${if} $R1 == "${APP_FILENAME}"
        ${GetParent} "$INSTDIR" $R2
        StrCpy $R3 "$R2\${PRODUCT_FILENAME}"
        ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
          Push "$INSTDIR"
          Push $R3
          Call dnCheckLegacyDir
          Pop $R4
          ${if} $R4 == ""
            Push "$INSTDIR"
            Call dnCanonical
            Pop $dnLegacyDir
            StrCpy $INSTDIR $R3
          ${else}
            ; Not provably the old install: upgrade in place, exactly as before.
            DetailPrint "Not moving $INSTDIR: $R4"
          ${endif}
        ${else}
          ; Fresh install (or a folder without our app, which is left alone).
          StrCpy $INSTDIR $R3
        ${endif}
      ${endif}

      ; A previous run that stopped before finishing: trust its journal only for
      ; this identity, this destination and a source that still passes the checks.
      ReadRegStr $R5 HKCU "${DN_MIGRATION_KEY}" "Identity"
      ${if} $R5 != ""
        ReadRegStr $R6 HKCU "${DN_MIGRATION_KEY}" "SourceDir"
        ReadRegStr $R7 HKCU "${DN_MIGRATION_KEY}" "DestDir"
        Push "$INSTDIR"
        Call dnCanonical
        Pop $R8
        Push $R7
        Call dnCanonical
        Pop $R7
        Push $R6
        Push $R8
        Call dnCheckLegacyDir
        Pop $R4
        ${if} $R5 != "${DN_MIGRATION_IDENTITY}"
          DetailPrint "Ignoring a migration journal for another app"
        ${elseif} $R7 != $R8
          DetailPrint "Ignoring a migration journal for $R7"
        ${elseif} $R4 != ""
          DetailPrint "Ignoring the migration journal for $R6: $R4"
        ${else}
          Push $R6
          Call dnCanonical
          Pop $R6
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
      ; A pending migration checks both folders, each on its own: a new exe that
      ; already exists never suppresses the check of the old folder.
      !insertmacro dnCloseAppIn "$dnLegacyDir" $dnClosePolicy $dnCloseResult
      ${if} $dnCloseResult == "cancel"
        Quit
      ${elseif} $dnCloseResult != "none"
      ${andIf} $dnCloseResult != "closed"
        ; Fail safe: install the new copy, keep the old folder, keep the journal.
        StrCpy $dnKeepLegacy "1"
        DetailPrint "Keeping $dnLegacyDir until ${PRODUCT_NAME} there can be closed"
      ${endif}
    ${endif}
    !insertmacro dnEnsureNotRunning "$INSTDIR"
    ${if} $dnLegacyDir != ""
      !insertmacro dnParkLegacyUninstaller
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
        ; Checked again right before deleting anything: the folders may have
        ; changed since customInit.
        Push $dnLegacyDir
        Push $INSTDIR
        Call dnCheckLegacyDir
        Pop $R8
        ${if} $dnKeepLegacy == "1"
          DetailPrint "Kept $dnLegacyDir; the next install or update retries"
        ${elseif} $R8 != ""
          DetailPrint "Kept $dnLegacyDir: $R8"
        ${else}
          Push $dnLegacyDir
          Call dnRemoveLegacyDir
          Pop $R8
          ${if} $R8 == "removed"
            DeleteRegKey HKCU "${DN_MIGRATION_KEY}"
          ${else}
            ; Something still holds a file; the next install or update retries.
            DetailPrint "Could not remove all of $dnLegacyDir; it will be retried"
          ${endif}
        ${endif}
      ${else}
        DetailPrint "The new install in $INSTDIR is incomplete; keeping $dnLegacyDir"
      ${endif}
    ${endif}
  !macroend
!endif
