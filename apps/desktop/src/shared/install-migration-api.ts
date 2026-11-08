export const INSTALL_MIGRATION_GET_STATUS_CHANNEL = 'install-migration:get-status'
export const INSTALL_MIGRATION_STATUS_EVENT_CHANNEL = 'install-migration:status-event'

/**
 * The app's side of the Windows install folder move (src/main/windows-install-migration.ts),
 * also recorded as AppMigration / AppMigrationLastAttempt / AppMigrationReason under
 * HKCU\Software\DoodleNote-InstallStatus\<APP_GUID>:
 *
 *  - pending: the installer's record is there but not finished: a step is left for the next
 *    try, or the record is not one this copy can act on yet (reason says which);
 *  - read-failed: the record could not be read at all; nothing was repointed;
 *  - complete: the login item and MCP clients were repointed and the record removed;
 *  - none: an earlier pending or read-failed state is over without a record (no move to finish).
 */
export type InstallMigrationState = 'pending' | 'read-failed' | 'complete' | 'none'

export interface InstallMigrationStatus {
  state: InstallMigrationState
  /** The attempt's time, UTC, to the second (YYYY-MM-DDTHH:MM:SSZ). */
  at: string
  /** A short machine-readable code (docs/WINDOWS-RELEASE-QA.md lists them). */
  reason: string
}

export interface InstallMigrationApi {
  /** The last status, or null when there is nothing to show (and on macOS). */
  getStatus(): Promise<InstallMigrationStatus | null>
  onStatus(cb: (status: InstallMigrationStatus | null) => void): () => void
}

/** What Settings shows for a status, or null for nothing (complete, none, or no status). */
export function installMigrationNotice(
  status: InstallMigrationStatus | null | undefined
): { title: string; detail: string } | null {
  if (!status) return null
  const stale =
    'Until then, Open at login and connected agents (Claude, Codex) may still start DoodleNote from the old folder, which the installer removed.'
  if (status.state === 'read-failed')
    return {
      title: "Couldn't finish the Windows upgrade",
      detail: `DoodleNote could not read the installer's note about moving it to its new folder (${status.reason}). It tries again in a few minutes and at every start. ${stale}`
    }
  if (status.state !== 'pending') return null
  if (status.reason.startsWith('steps-pending'))
    return {
      title: 'Finishing the Windows upgrade…',
      detail: `Some settings that still point at the old install folder could not be updated yet (${status.reason}). DoodleNote tries again in a few minutes and at every start. ${stale}`
    }
  return {
    title: 'Finishing the Windows upgrade…',
    detail: `The installer's note about moving DoodleNote is waiting for the installer (${status.reason}): running the DoodleNote installer again finishes it. ${stale}`
  }
}
