import { GenerationError } from '@repo/ai'
import type { EnhanceIdentity } from '../shared/notes-api'

/** Owns cancellation until the producer AND its cleanup have settled. */
export class NotesGenerationJobs {
  private active: {
    identity: EnhanceIdentity
    owner: number
    controller: AbortController
    done: Promise<void>
  } | null = null
  get busy(): boolean {
    return this.active !== null
  }

  async run<T>(
    identity: EnhanceIdentity,
    owner: number,
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (this.active)
      throw new Error('Notes are already being generated. Wait for cleanup before retrying.')
    const controller = new AbortController()
    let finish!: () => void
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    const job = { identity, owner, controller, done }
    this.active = job
    try {
      const result = await work(controller.signal)
      controller.signal.throwIfAborted()
      return result
    } finally {
      if (this.active === job) this.active = null
      finish()
    }
  }

  cancel(identity: EnhanceIdentity, owner: number): boolean {
    const job = this.active
    if (
      !job ||
      job.owner !== owner ||
      job.identity.runId !== identity.runId ||
      job.identity.meetingId !== identity.meetingId
    )
      return false
    job.controller.abort(
      new GenerationError(
        'canceled',
        'Notes generation canceled. Your existing notes are unchanged.'
      )
    )
    return true
  }

  async stop(): Promise<void> {
    const job = this.active
    if (!job) return
    job.controller.abort(new GenerationError('canceled', 'Notes generation canceled.'))
    await job.done
  }
}
