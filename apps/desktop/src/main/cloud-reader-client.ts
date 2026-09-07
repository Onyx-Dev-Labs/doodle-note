import type { ReaderAction, ReaderQuery } from '@repo/cloud-reader/types'
export type CloudReaderRequest =
  | { kind: 'list'; after?: string }
  | { kind: 'detail'; query: ReaderQuery }
  | { kind: 'action'; value: ReaderAction }
  | { kind: 'preview'; libraryId: string; noteId: string; revisionId: string; versionId: string }
export function cloudReaderClient(
  credentials: () => { token: string | null; enabled: boolean; baseUrl: string },
  fetcher: typeof fetch = fetch
) {
  return async (value: unknown): Promise<unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid cloud request.')
    const r = value as CloudReaderRequest
    const auth = { ...credentials() }
    if (!auth.token || !auth.enabled)
      throw new Error('Connect and enable Cloud Sync in Settings to read mobile notes.')
    const q = new URLSearchParams()
    let body: unknown
    if (r.kind === 'list') {
      if (r.after) q.set('after', String(r.after))
    } else if (r.kind === 'detail') {
      if (!r.query?.noteId) throw new Error('Invalid cloud request.')
      for (const key of ['noteId', 'revisionId', 'after'] as const)
        if (r.query[key]) q.set(key, String(r.query[key]))
    } else if (r.kind === 'preview') {
      for (const key of ['libraryId', 'noteId', 'revisionId', 'versionId'] as const) {
        if (typeof r[key] !== 'string') throw new Error('Invalid cloud request.')
        q.set(key, r[key])
      }
      q.set('mode', 'preview')
      q.set('part', 'preview')
    } else if (r.kind === 'action') {
      body = r.value
      if (!body) throw new Error('Invalid cloud request.')
    } else throw new Error('Invalid cloud request.')
    try {
      const response = await fetcher(`${auth.baseUrl}/api/sync/reader?${q}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
        cache: 'no-store'
      })
      if (!response.ok) throw new Error('unavailable')
      const result =
        r.kind === 'preview' ? new Uint8Array(await response.arrayBuffer()) : await response.json()
      const current = credentials()
      if (current.token !== auth.token || !current.enabled) throw new Error('workspace_changed')
      return result
    } catch {
      throw new Error(
        'Cloud notes unavailable. Check your connection, account and sync subscription, then retry.'
      )
    }
  }
}
