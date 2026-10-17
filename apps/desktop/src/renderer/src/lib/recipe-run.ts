const active = new Map<string, () => void>()
export function registerRecipeRun(meetingId: string, cancel: () => void): () => void {
  active.set(meetingId, cancel)
  return () => {
    if (active.get(meetingId) === cancel) active.delete(meetingId)
  }
}
/** Invalidate on unsaved edits too; do not wait for the debounced disk write. */
export function invalidateRecipeRun(meetingId: string): void {
  active.get(meetingId)?.()
}
