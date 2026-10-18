import type {
  SourceAnchor,
  SourceResolution,
  SourceSearchResult
} from '@repo/meetings-store/source-contract'
export const SOURCES_SEARCH = 'sources:search'
export const SOURCES_RESOLVE = 'sources:resolve'
export const SOURCES_CANCEL = 'sources:cancel'
export const SOURCES_STATE = 'sources:state'
export interface SourcesApi {
  /** Cancels this local retrieval lane; pending results cannot be delivered afterward. */
  cancel(): Promise<void>
  search(query: string, limit?: number): Promise<SourceSearchResult>
  resolve(anchor: SourceAnchor): Promise<SourceResolution>
  state(): Promise<'starting' | 'dirty' | 'reconciling' | 'ready' | 'unavailable' | 'closed'>
}
