export type CaptureOwner = 'meeting' | 'dictation'

export interface CaptureLease {
  readonly owner: CaptureOwner
  readonly token: number
}

export type CaptureClaim =
  { ok: true; lease: CaptureLease } | { ok: false; heldBy: CaptureOwner; message: string }

/**
 * Who may use the one transcription sidecar. `EngineProcess.start()` retires
 * whatever is running, so every caller that is not the meeting recorder must
 * claim here first and must never start over a meeting that is recording or
 * still finishing. A claim is held until the sidecar session has fully ended,
 * not merely until the user pressed stop, so a late final result can never be
 * routed to the next owner.
 */
export class CaptureOwnership {
  private held: CaptureLease | null = null
  private nextToken = 1

  get owner(): CaptureOwner | null {
    return this.held?.owner ?? null
  }

  /** Dictation is refused while any other owner holds the sidecar. */
  claim(owner: CaptureOwner, engineBusy: boolean): CaptureClaim {
    if (this.held) {
      return { ok: false, heldBy: this.held.owner, message: refusal(owner, this.held.owner) }
    }
    // An untracked sidecar session (a recording whose lease predates this
    // process state, or a finishing capture) still blocks dictation.
    if (owner === 'dictation' && engineBusy) {
      return { ok: false, heldBy: 'meeting', message: refusal('dictation', 'meeting') }
    }
    this.held = { owner, token: this.nextToken++ }
    return { ok: true, lease: this.held }
  }

  /** Idempotent and token-checked: a stale holder cannot release a newer claim. */
  release(lease: CaptureLease): boolean {
    if (!this.held || this.held.token !== lease.token) return false
    this.held = null
    return true
  }

  isHeldBy(lease: CaptureLease): boolean {
    return this.held?.token === lease.token
  }
}

function refusal(requested: CaptureOwner, heldBy: CaptureOwner): string {
  if (requested === 'dictation') {
    return heldBy === 'meeting'
      ? 'A meeting is recording or still finishing. Dictation starts again once it ends.'
      : 'Dictation is already in progress.'
  }
  return 'Dictation is using the microphone. Finish or cancel it, then start recording.'
}
