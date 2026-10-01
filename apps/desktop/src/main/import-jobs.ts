import { randomUUID } from 'node:crypto'
import type { ImportProgress } from '../shared/import-api'

export class ImportCanceledError extends Error {
  constructor() {
    super('Import canceled.')
    this.name = 'AbortError'
  }
}

export function checkImportCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ImportCanceledError()
}

export interface ImportJobContext {
  signal: AbortSignal
  progress(stage: ImportProgress['stage'], progress?: number, part?: number, parts?: number): void
  /** A synchronous commit is indivisible with respect to cancel IPC. */
  commit<T>(write: () => T): T
}

/** Main owns job identity and terminal state, independently of renderer lifetime. */
export class ImportJobs {
  private state: ImportProgress | null = null
  private active: { controller: AbortController; done: Promise<void> } | null = null
  private revision = 0

  constructor(private readonly publish: (state: ImportProgress) => void) {}

  get busy(): boolean {
    return this.active !== null
  }
  snapshot(): ImportProgress | null {
    return this.state ? { ...this.state } : null
  }

  private update(patch: Partial<ImportProgress>): void {
    if (!this.state) return
    this.state = { ...this.state, ...patch, revision: ++this.revision }
    this.publish({ ...this.state })
  }

  async run<T>(
    identity: Pick<ImportProgress, 'kind' | 'meetingId' | 'label'>,
    operation: (context: ImportJobContext) => Promise<T>
  ): Promise<T> {
    if (this.active) throw new Error('Another import is still running. Please wait or cancel it.')
    const controller = new AbortController()
    let finish!: () => void
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.active = { controller, done }
    this.state = { ...identity, jobId: randomUUID(), stage: 'starting', revision: ++this.revision }
    this.publish({ ...this.state })
    try {
      const result = await operation({
        signal: controller.signal,
        progress: (stage, progress, part, parts) => {
          if (controller.signal.aborted) return
          this.update({
            stage,
            progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress!)) : undefined,
            part,
            parts
          })
        },
        commit: (write) => {
          checkImportCanceled(controller.signal)
          this.update({ stage: 'finishing', progress: undefined })
          return write()
        }
      })
      this.update({ stage: 'completed', progress: undefined })
      return result
    } catch (error) {
      const canceled = controller.signal.aborted
      this.update({
        stage: canceled ? 'canceled' : 'failed',
        progress: undefined,
        error: canceled ? undefined : error instanceof Error ? error.message : String(error)
      })
      throw canceled ? new ImportCanceledError() : error
    } finally {
      this.active = null
      finish()
    }
  }

  async cancel(jobId: string): Promise<ImportProgress | null> {
    if (
      this.state?.jobId !== jobId ||
      !this.active ||
      this.state.stage === 'finishing' ||
      this.state.stage === 'completed'
    )
      return this.snapshot()
    const active = this.active
    if (!active.controller.signal.aborted) {
      this.update({ stage: 'canceling', progress: undefined })
      active.controller.abort()
    }
    // The operation must acknowledge the abort (including child process exit)
    // before callers can move the library or start another job.
    await active.done
    return this.snapshot()
  }
}
