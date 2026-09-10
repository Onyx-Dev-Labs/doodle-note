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
  private pending = false
  private failure: string | undefined
  private running: GenerationRun | null = null

  startCapture(captureId?: string): void {
    this.capture++
    this.captureId = captureId
    this.capturing = true
    this.pending = false
    this.failure = undefined
  }

  finalize(error?: string, captureId?: string): boolean {
    if (!this.capturing || captureId !== this.captureId) return false
    this.capturing = false
    this.pending = true
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
