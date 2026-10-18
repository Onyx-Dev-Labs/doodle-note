type CancelReason = 'edited' | 'canceled'
const active = new Map<string, (reason: CancelReason) => void>()
export function registerRecipeRun(
  meetingId: string,
  cancel: (reason: CancelReason) => void
): () => void {
  active.set(meetingId, cancel)
  return () => {
    if (active.get(meetingId) === cancel) active.delete(meetingId)
  }
}
/** Invalidate pending flush as well as native work; unsaved edits cannot race the debounce. */
export function invalidateRecipeRun(meetingId: string, reason: CancelReason = 'edited'): void {
  active.get(meetingId)?.(reason)
}
/** An ambiguous IPC failure must retry the same ID, recovering a possibly committed artifact. */
export class RecipeAttempts {
  private pending: { key: string; id: string } | null = null
  begin(key: string, mint: () => string = () => crypto.randomUUID()): string {
    if (this.pending?.key !== key) this.pending = { key, id: mint() }
    return this.pending.id
  }
  complete(id: string): void {
    if (this.pending?.id === id) this.pending = null
  }
}
