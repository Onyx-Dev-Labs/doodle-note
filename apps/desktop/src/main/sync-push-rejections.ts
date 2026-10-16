/**
 * Per-meeting push rejections — pure, unit-testable.
 *
 * Meetings moved to another cloud workspace from the web (before moves were
 * disabled) keep their id there, so every push from this device's workspace
 * is refused. Retrying identical content can never succeed, so such meetings
 * are parked until their content changes or the user presses Sync now, and
 * the status UI reports them instead of the push loop retrying silently.
 */

/** Per-meeting error from POST /api/sync/push when the id is owned elsewhere. */
export const OTHER_WORKSPACE_REJECTION = 'id belongs to another workspace'

export function isOtherWorkspaceRejection(error: string | undefined): boolean {
  return error === OTHER_WORKSPACE_REJECTION
}

/**
 * Split push candidates into those to send and those parked because this
 * exact content was already refused as belonging to another workspace.
 */
export function partitionPushCandidates<T extends { id: string }>(
  candidates: readonly T[],
  blocked: Readonly<Record<string, string>>,
  hashOf: (record: T) => string
): { pending: T[]; blocked: T[] } {
  const pending: T[] = []
  const parked: T[] = []
  for (const record of candidates) {
    if (blocked[record.id] !== undefined && blocked[record.id] === hashOf(record)) {
      parked.push(record)
    } else {
      pending.push(record)
    }
  }
  return { pending, blocked: parked }
}

/** Status line for meetings parked as belonging to another workspace. */
export function otherWorkspaceMessage(count: number): string | undefined {
  if (count <= 0) return undefined
  return count === 1
    ? "1 meeting can't sync: it belongs to another workspace on the web."
    : `${count} meetings can't sync: they belong to another workspace on the web.`
}

/** Error surfaced when the cloud refused meetings for retryable reasons. */
export function rejectedPushMessage(count: number): string | undefined {
  if (count <= 0) return undefined
  return count === 1
    ? '1 meeting was rejected by the cloud and will retry on the next sync.'
    : `${count} meetings were rejected by the cloud and will retry on the next sync.`
}
