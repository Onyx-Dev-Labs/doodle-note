import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { SourceIndexClient } from '@repo/meetings-store/source-index-client'
import { localSourceScope } from '@repo/meetings-store/sources'
import type { SourceAnchor } from '@repo/meetings-store/source-contract'
import { libraryIpc } from './library-ipc'
import {
  SOURCES_CANCEL,
  SOURCES_RESOLVE,
  SOURCES_SEARCH,
  SOURCES_STATE
} from '../shared/source-api'

/** Trusted library scope is selected by main, never supplied by a renderer or signed-in account. */
export class SourceIndexService {
  private client: SourceIndexClient
  constructor(meetingsDir: string, cacheDir: string, assertAvailable: () => void) {
    assertAvailable()
    const worker = new Worker(join(__dirname, 'source-index-worker.js'), {
      workerData: { meetingsDir, cacheDir }
    })
    this.client = new SourceIndexClient(worker, () => {
      assertAvailable()
      return { meetingsDir, scope: localSourceScope(meetingsDir), authorized: true }
    })
  }
  invalidate(): void {
    this.client.invalidate()
  }
  dispose(): Promise<void> {
    return this.client.close()
  }
  registerIpc(): void {
    libraryIpc.handle(SOURCES_CANCEL, () => this.client.invalidate())
    libraryIpc.handle(SOURCES_SEARCH, (_event, query: unknown, limit: unknown) => {
      if (typeof query !== 'string' || query.length > 4096) throw new Error('Invalid source query')
      if (
        limit !== undefined &&
        (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000)
      )
        throw new Error('Invalid source limit')
      return this.client.search(query, limit as number | undefined)
    })
    libraryIpc.handle(SOURCES_RESOLVE, (_event, anchor: SourceAnchor) =>
      this.client.resolve(anchor)
    )
    libraryIpc.handle(SOURCES_STATE, () => this.client.state)
  }
}
