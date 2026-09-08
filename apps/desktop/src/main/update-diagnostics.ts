import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs'
import type { UpdateState } from '../shared/update-api'

export type UpdateDiagnosticEvent =
  UpdateState['status'] | 'launch' | 'before-quit' | 'quit' | 'installer-error' | 'cleanup-timeout'

/** Local, bounded lifecycle evidence. Never accepts paths, URLs or error messages. */
export function writeUpdateDiagnostic(
  file: string,
  event: UpdateDiagnosticEvent,
  version: string,
  targetVersion?: string
): void {
  const safeVersion = (value?: string): string | undefined =>
    value && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-zA-Z0-9.-]{1,32})?$/.test(value) ? value : undefined
  try {
    if (existsSync(file) && statSync(file).size >= 512 * 1024) {
      rmSync(file + '.previous', { force: true })
      renameSync(file, file + '.previous')
    }
    appendFileSync(
      file,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        pid: process.pid,
        event,
        version: safeVersion(version),
        targetVersion: safeVersion(targetVersion)
      }) + '\n'
    )
  } catch {
    // Diagnostics must never prevent a user from updating or quitting.
  }
}
