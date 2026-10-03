/** Only explicit false opts out, including for settings saved before this field existed. */
export function autoGenerateNotesAfterStop(value: unknown): boolean {
  return value !== false
}

export interface GenerationRun {
  capture: number
  revision: number
}

/** Synchronous ownership across renderer events, async IPC and React rerenders. */
export class MeetingGeneration {
  private capture = 0
  private captureId: string | undefined
  private revision = 0
  private capturing = false
  private ready = false
  private pending = false
  private failure: string | undefined
  private running: GenerationRun | null = null

  startCapture(captureId?: string): void {
    this.capture++
    this.captureId = captureId
    this.capturing = true
    this.ready = false
    this.pending = false
    this.failure = undefined
  }

  markReady(): void {
    if (this.capturing) this.ready = true
  }

  finalize(error?: string, captureId?: string): boolean {
    if (!this.capturing || captureId !== this.captureId) return false
    this.capturing = false
    // A denied or cancelled startup has no completed recording to summarize.
    // Still accept finalization so the recorder returns to an idle/retry state.
    this.pending = this.ready
    this.failure = error
    return true
  }

  edit(): void {
    this.revision++
  }

  invalidate(): void {
    this.capture++
    this.capturing = false
    this.pending = false
  }

  takeAutomatic(): { error?: string } | null {
    if (!this.pending) return null
    this.pending = false
    return this.failure ? { error: this.failure } : {}
  }

  begin(): GenerationRun | null {
    if (this.capturing || this.running) return null
    this.pending = false // A manual click consumes the same completed capture.
    const run = { capture: this.capture, revision: this.revision }
    this.running = run
    return run
  }

  isCurrent(run: GenerationRun): boolean {
    return this.running === run && run.capture === this.capture && run.revision === this.revision
  }

  finish(run: GenerationRun): void {
    if (this.running === run) this.running = null
  }
}
