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
;      It also requires every registered uninstall command to be exactly the old
;      (or new) folder's own uninstaller, compared normalised (short names, case);
;      any other command could not be parked, so the install is upgraded in place.
;   2. customCheckAppRunning (dnMigrationClose) closes copies running from
;      exactly the old exe and exactly the new exe, each checked on its own
;      (never electron-builder's path-prefix or image-name matching), then parks
;      the old uninstall command in a journal (dnParkUninstaller) so
;      electron-builder's "uninstall old version" step cannot delete the old folder
;      before the new one exists. A silent install without --updated quits with
;      exit code 2 if the old app is running, before anything is closed, parked,
;      extracted or deleted; only customInit's registry repairs (recovered
;      journal/record, a parked uninstall command put back, an untrusted
;      journal's shortcut answers dropped) may already have happened.
;   3. customInstall verifies the new install, keeps the user's desktop and
;      Start menu shortcut choices (recorded before the old version was touched),
;      repoints taskbar pins that start exactly the old exe (dnRepointPins), then
;      dnFinishMigration pins the old folder (an open handle nobody can rename or
;      replace), checks it again on that handle and only then removes exactly that
;      folder, through handles verified to be inside it (never following links,
;      never re-opening it by path, never entering the profile or the new folder). Only
;      when the old folder is really gone does it write the record (one value,
;      MigrationRecord, in HKCU\Software\${APP_GUID}) that lets the app repoint its
;      login item and MCP client entries, and only then clear the journal: a run
;      that stops in between leaves the journal of a move whose old folder is gone,
;      and the next run writes the record (dnJournalDone / dnCompleteMove).
;
; The journal, HKCU\Software\${APP_GUID}\InstallMigration, belongs to this app
; identity (APP_GUID derives from appId) and records the identity and both
; folders. A later run trusts it (dnTrustedJournal) only when all three still
; match and the old folder passes the same checks; it then finishes an
; interrupted migration. If the app cannot be closed, or which processes are ours
; cannot be established, the new install goes ahead, the old folder stays and the
; journal stays armed. electron-builder's uninstaller deletes Software\${APP_GUID}
; (journal and record) whenever "uninstall old version" runs it, so the journal
; and the record are copied before that step to
; HKCU\Software\DoodleNote-InstallRecovery\${APP_GUID} (outside that subtree) and
; written back after it (dnSaveState / dnRestoreState), or by the next run's
; customInit if this one stops in between (dnRecoverState): the journal stays
; armed for as many runs as it takes, and a record survives updates until the app
; has consumed it. Each of those steps can itself be cut short at any write and is
; finished by the next run; the copy is deleted only once all of it reads back.
; A user uninstall of the new copy while a move is unfinished also removes the
; old folder (customUnInstall, dnUninstallLegacy).
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
!define DN_UNINSTALLER_EXE "Uninstall ${PRODUCT_FILENAME}.exe"
; What a journal must name to be trusted by this installer.
!define DN_MIGRATION_IDENTITY "${APP_GUID}|${APP_FILENAME}|${PRODUCT_FILENAME}"
; Where each run records what it decided (dnStatus): LastRun / LastStep /
; LastResult / LastReason per identity, outside Software\${APP_GUID} (which
; electron-builder's uninstaller deletes on every update), and a log in %TEMP%.
!define DN_STATUS_KEY "Software\DoodleNote-InstallStatus\${APP_GUID}"
!define DN_STATUS_LOG "$TEMP\DoodleNote-install-${APP_ID}.log"
!ifdef BUILD_UNINSTALLER
!if "${APP_FILENAME}" != "${PRODUCT_FILENAME}"
  ; The uninstaller removes an old folder left by an unfinished move.
  !define DN_WITH_UNINSTALL_LEGACY
!endif
!endif
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
  ; the MigrationRecord of one that was completed.
  !define DN_STATE_KEY "Software\${APP_GUID}"
  !define DN_MIGRATION_KEY "${DN_STATE_KEY}\InstallMigration"
  ; A copy of both, outside the Software\${APP_GUID} subtree electron-builder's
  ; uninstaller deletes, for an installer that stops between that step and
  ; customInstall (dnSaveState / dnRecoverState).
  !define DN_RECOVERY_KEY "Software\DoodleNote-InstallRecovery\${APP_GUID}"
  !define DN_TASKBAR_PINS "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

  Var dnLegacyDir
  ; "1" when the user had the old install's desktop / Start menu shortcut.
  Var dnHadDesktopLink
  Var dnHadStartMenuLink
  ; "1" when the old folder must stay this run (its app could not be closed).
  Var dnKeepLegacy
  ; The plan's reason code, recorded again when an in-place install completes.
  Var dnInstallWhy
  ; The old folder of a move an earlier run removed but did not record
  ; (dnJournalDone); customInstall finishes it.
  Var dnDoneLegacy

  ; Exactly what electron-builder registers for a per-user install in DIR.
  !macro dnUninstallCommand DIR OUT
    StrCpy ${OUT} '"${DIR}\${UNINSTALL_FILENAME}" /currentuser'
  !macroend

  !macro customInit
    StrCpy $dnLegacyDir ""
    StrCpy $dnDoneLegacy ""
    StrCpy $dnHadDesktopLink "1"
    StrCpy $dnHadStartMenuLink "1"
    StrCpy $dnKeepLegacy "0"
    StrCpy $dnStatusKey "${DN_STATUS_KEY}"
    StrCpy $dnStatusLog "${DN_STATUS_LOG}"
    StrCpy $dnProgramsRoot "$LOCALAPPDATA\Programs"
    StrCpy $dnProfileDir "$APPDATA\${APP_FILENAME}"
    StrCpy $dnJournalKey "${DN_MIGRATION_KEY}"
    StrCpy $dnStateKey "${DN_STATE_KEY}"
    StrCpy $dnRecoveryKey "${DN_RECOVERY_KEY}"
    StrCpy $dnUninstallKey "${UNINSTALL_REGISTRY_KEY}"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      StrCpy $dnUninstallKey2 "${UNINSTALL_REGISTRY_KEY_2}"
    !else
      StrCpy $dnUninstallKey2 ""
    !endif
    ; An earlier run that stopped after "uninstall old version" deleted the
    ; journal and record: put them back (checked) before anything reads them.
    Call dnRecoverState
    !insertmacro GetDParameter $R0
    ${if} $R0 == ""
      StrCpy $dnPlanDir "$INSTDIR"
      Call dnPlanMigration
      StrCpy $INSTDIR $dnPlanDir
      StrCpy $dnLegacyDir $dnPlanLegacy
      StrCpy $dnInstallWhy $dnWhy
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
        !insertmacro dnStatus note journal-ignored $dnWhy ""
      ${endif}
      ${if} $R6 == ""
        ; Shortcut answers recorded by an untrusted journal are not this move's.
        DeleteRegValue HKCU "${DN_MIGRATION_KEY}" "DesktopLink"
        DeleteRegValue HKCU "${DN_MIGRATION_KEY}" "StartMenuLink"
      ${else}
        ${if} $dnLegacyDir == ""
          StrCpy $dnLegacyDir $R6
          StrCpy $dnInstallWhy "journal-resumed"
          !insertmacro dnStatus plan plan-move journal-resumed "from=$R6 to=$INSTDIR"
        ${endif}
        ; Put back a parked uninstall command only if it is exactly the old
        ; folder's own uninstaller and nothing is registered now, so Apps &
        ; features works even if this run is cancelled.
        ${if} $dnLegacyDir == $R6
          ReadRegStr $R7 HKCU "${DN_MIGRATION_KEY}" "LegacyUninstallString"
          ReadRegStr $R8 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
          Push $R7
          Call dnUninstallerDir
          Pop $R9
          ${if} $R9 == $R6
          ${andIf} $R8 == ""
          ${andIf} ${FileExists} "$R6\${UNINSTALL_FILENAME}"
            WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString" $R7
          ${endif}
        ${endif}
      ${endif}

      ; Every registered uninstall command must be one we can park (the old
      ; folder's own uninstaller, however its path is spelled) or the new one's;
      ; anything else would run before the new copy exists: upgrade in place.
      ${if} $dnLegacyDir != ""
        Push $dnLegacyDir
        Push $INSTDIR
        Call dnCheckUninstallCommand
        Pop $R6
        ${if} $R6 != ""
          DetailPrint "Not moving $dnLegacyDir: $R6"
          StrCpy $INSTDIR $dnLegacyDir
          StrCpy $dnLegacyDir ""
          StrCpy $dnInstallWhy "uninstall-command"
          !insertmacro dnStatus plan plan-in-place uninstall-command "to=$INSTDIR"
        ${endif}
      ${endif}

      ; Nothing to move, but an earlier run's move may have removed its old folder
      ; and stopped before writing the record: customInstall finishes it.
      ${if} $dnLegacyDir == ""
        Push "$INSTDIR"
        Call dnJournalDone
        Pop $dnDoneLegacy
      ${endif}
    ${else}
      StrCpy $dnInstallWhy "custom-dir"
      !insertmacro dnStatus plan plan-in-place custom-dir "to=$INSTDIR"
    ${endif}

  !macroend

  !macro dnMigrationCheckAppRunning
    ${if} $dnLegacyDir != ""
      Push $dnLegacyDir
      Push $INSTDIR
      Call dnMigrationClose
      Pop $dnKeepLegacy
      Push $dnLegacyDir
      Push $INSTDIR
      Call dnParkUninstaller
      Pop $R6
      ${if} $R6 != "parked"
      ${andIf} $R6 != "nothing to park"
        ; Cannot happen after customInit's check; never let the old uninstaller run.
        DetailPrint "Not moving $dnLegacyDir: $R6"
        SetErrorLevel 2
        Quit
      ${endif}
      DetailPrint "Moving ${PRODUCT_NAME} from $dnLegacyDir to $INSTDIR"
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
    ; "uninstall old version" runs next and deletes Software\${APP_GUID}.
    Call dnSaveState
  !macroend

  !macro customInstall
    ; Put back the journal and record "uninstall old version" deleted.
    Call dnRestoreState
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
        !insertmacro dnStatus install kept incomplete-install "from=$dnLegacyDir to=$INSTDIR"
      ${endif}
    ${else}
      !insertmacro dnStatus install in-place $dnInstallWhy "to=$INSTDIR"
      ReadRegStr $R7 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      !insertmacro dnUninstallCommand "$INSTDIR" $R9
      ${if} $dnDoneLegacy != ""
      ${andIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ${andIf} ${FileExists} "$INSTDIR\resources\app.asar"
      ${andIf} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      ${andIf} $R7 == $R9
        Push $dnDoneLegacy
        Push $INSTDIR
        Call dnCompleteMove
      ${endif}
    ${endif}
  !macroend
!endif

; Uninstaller: a user uninstall (not an update's --updated run) of the new copy
; while a move into it is unfinished also removes the old folder that move left
; behind (dnUninstallLegacy), before electron-builder deletes the journal with
; Software\${APP_GUID}.
!ifdef DN_WITH_UNINSTALL_LEGACY
  ; A one-click uninstaller calls SetSilent silent before the uninstall section
  ; (after its own "are you sure?" and app-running prompts), so ${Silent} is always
  ; true by customUnInstall and dnClosePolicy would say "never" even when the user
  ; started it from Apps & features. The policy for the old folder's app is decided
  ; here, from the command line: --updated closes (an update asked for it), /S
  ; never closes, anything else asks (the user is there).
  !macro customUnInit
    ${if} ${isUpdated}
      StrCpy $dnClosePolicy "close"
    ${else}
      ${GetParameters} $R0
      ClearErrors
      ${GetOptions} $R0 "/S" $R1
      ${if} ${Errors}
        StrCpy $dnClosePolicy "ask"
      ${else}
        StrCpy $dnClosePolicy "never"
      ${endif}
    ${endif}
  !macroend

  !macro customUnInstall
    ${ifNot} ${isUpdated}
      ; $dnClosePolicy: customUnInit's, not dnClosePolicy (always "never" here).
      StrCpy $dnRunKey "Software\Microsoft\Windows\CurrentVersion\Run"
      StrCpy $dnStartupKey "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
      StrCpy $dnLoginItem "${APP_ID}"
      StrCpy $dnProgramsRoot "$LOCALAPPDATA\Programs"
      StrCpy $dnProfileDir "$APPDATA\${APP_FILENAME}"
      StrCpy $dnJournalKey "Software\${APP_GUID}\InstallMigration"
      StrCpy $dnStatusKey "${DN_STATUS_KEY}"
      StrCpy $dnStatusLog "${DN_STATUS_LOG}"
      Push $INSTDIR
      Call un.dnUninstallLegacy
      Pop $R0
      ; The installer's copy of the journal and record goes with them (an
      ; update's --updated run keeps it: the installer that started it needs it).
      DeleteRegKey HKCU "Software\DoodleNote-InstallRecovery\${APP_GUID}"
      DeleteRegKey /ifempty HKCU "Software\DoodleNote-InstallRecovery"
    ${endif}
  !macroend
!endif
