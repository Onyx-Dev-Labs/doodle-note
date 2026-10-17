import { ipcMain } from 'electron'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import {
  SourceIndexClient,
  StaleSourceRequestError,
  type SourceIndexState
} from '@repo/meetings-store/source-index-client'
import { localSourceScope } from '@repo/meetings-store/sources'
import type { SourceAnchor } from '@repo/meetings-store/source-contract'
import { libraryIpc } from './library-ipc'
import {
  SOURCES_CANCEL,
  SOURCES_RESOLVE,
  SOURCES_SEARCH,
  SOURCES_STATE
} from '../shared/source-api'

type Binding = { directory: string; client: SourceIndexClient }

/** Trusted library scope is selected by main, never supplied by a renderer or signed-in account. */
export class SourceIndexService {
  private binding?: Binding
  private retirement: Promise<void> = Promise.resolve()
  private generation = 0
  private pending = new Set<(error: Error) => void>()
  private closed = false
  private retirementFailed = false
  private readonly meetingsDir: () => string

  constructor(
    meetingsDir: string | (() => string),
    private readonly cacheDir: string,
    private readonly assertAvailable: () => void
  ) {
    this.meetingsDir = typeof meetingsDir === 'string' ? () => meetingsDir : meetingsDir
    assertAvailable()
    this.binding = this.start(this.meetingsDir())
  }

  private start(directory: string): Binding {
    const worker = new Worker(join(__dirname, 'source-index-worker.js'), {
      workerData: { meetingsDir: directory, cacheDir: this.cacheDir }
    })
    const client = new SourceIndexClient(worker, () => {
      this.assertAvailable()
      if (directory !== this.meetingsDir()) throw new StaleSourceRequestError()
      return { meetingsDir: directory, scope: localSourceScope(directory), authorized: true }
    })
    return { directory, client }
  }

  invalidate(): void {
    this.generation++
    for (const reject of this.pending) reject(new StaleSourceRequestError())
    this.pending.clear()
    this.binding?.client.invalidate()
  }

  /** Called after storage switches its active root, before the relocation barrier opens. */
  refreshLibraryPath(): void {
    this.invalidate()
    const previous = this.binding
    this.binding = undefined
    // Never start another SQLite writer until the old worker has actually exited.
    this.retirement = this.retirement.then(() => previous?.client.close())
    void this.retirement.catch(() => {
      this.retirementFailed = true
    })
  }

  private async withClient<T>(operation: (client: SourceIndexClient) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('Source worker unavailable')
    this.assertAvailable()
    const directory = this.meetingsDir()
    // Also detect changes without a callback; never query the recovery copy.
    if (this.binding && this.binding.directory !== directory) this.refreshLibraryPath()
    const generation = this.generation
    let cancel!: (error: Error) => void
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = reject
    })
    this.pending.add(cancel)
    try {
      return await Promise.race([this.run(directory, generation, operation), cancelled])
    } finally {
      this.pending.delete(cancel)
    }
  }

  private async run<T>(
    directory: string,
    generation: number,
    operation: (client: SourceIndexClient) => Promise<T>
  ): Promise<T> {
    await this.retirement
    this.assertAvailable()
    if (this.closed || generation !== this.generation || directory !== this.meetingsDir())
      throw new StaleSourceRequestError()
    const binding = (this.binding ??= this.start(directory))
    const result = await operation(binding.client)
    this.assertAvailable()
    if (
      generation !== this.generation ||
      binding !== this.binding ||
      directory !== this.meetingsDir()
    )
      throw new StaleSourceRequestError()
    return result
  }

  private state(): SourceIndexState {
    if (this.closed) return 'closed'
    if (this.retirementFailed) return 'unavailable'
    try {
      this.assertAvailable()
      if (this.binding?.directory !== this.meetingsDir()) return 'starting'
      return this.binding.client.state
    } catch {
      return 'unavailable'
    }
  }

  async dispose(): Promise<void> {
    this.closed = true
    this.refreshLibraryPath()
    await this.retirement
  }

  registerIpc(): void {
    // Cancellation only invalidates in-memory jobs/atomic flags. It must bypass
    // the library barrier: relocation may be draining the very request it stops.
    // libraryIpc adds no sender checks; the Electron IPC surface stays unchanged.
    ipcMain.handle(SOURCES_CANCEL, () => this.invalidate())
    libraryIpc.handle(SOURCES_SEARCH, (_event, query: unknown, limit: unknown) => {
      if (typeof query !== 'string' || query.length > 4096) throw new Error('Invalid source query')
      if (
        limit !== undefined &&
        (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000)
      )
        throw new Error('Invalid source limit')
      return this.withClient((client) => client.search(query, limit as number | undefined))
    })
    libraryIpc.handle(SOURCES_RESOLVE, (_event, anchor: SourceAnchor) =>
      this.withClient((client) => client.resolve(anchor))
    )
    libraryIpc.handle(SOURCES_STATE, () => this.state())
  }
}
