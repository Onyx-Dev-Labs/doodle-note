export interface MeetingText {
  title: string
  rawNotesMarkdown: string
}
/** One serialized writer per mounted meeting. Failure keeps edits dirty; flush drains newer edits. */
export class MeetingTextSaves {
  private saved: MeetingText | null = null
  private desired: MeetingText | null = null
  private pending: Promise<void> | null = null
  private discarded = false
  constructor(private readonly write: (patch: Partial<MeetingText>) => Promise<unknown>) {}

  load(value: MeetingText): void {
    this.saved = { ...value }
    this.desired = { ...value }
  }
  edit(value: Partial<MeetingText>): void {
    if (this.desired && !this.discarded) this.desired = { ...this.desired, ...value }
  }
  async flush(): Promise<void> {
    while (!this.discarded && this.saved && this.desired) {
      if (this.pending) {
        await this.pending
        continue
      }
      const patch: Partial<MeetingText> = {}
      for (const key of ['title', 'rawNotesMarkdown'] as const)
        if (this.desired[key] !== this.saved[key]) patch[key] = this.desired[key]
      if (Object.keys(patch).length === 0) return
      // Set pending before calling a writer that might throw synchronously.
      this.pending = Promise.resolve()
        .then(async () => {
          if (this.discarded) return
          await this.write(patch)
          this.saved = { ...this.saved!, ...patch }
        })
        .finally(() => {
          this.pending = null
        })
      await this.pending
    }
  }
  /** Drain already-dispatched writes before deletion; never start an unsent edit afterward. */
  async discard(): Promise<void> {
    this.discarded = true
    await this.pending?.catch(() => {})
  }
  resume(): void {
    this.discarded = false
  }
}
