type Connection = { token: string | null; baseUrl: string; revision: number }

/** Read-only account check; no cached grant; the device token is never sent to the renderer. */
export function remoteMcpEligibilityClient(
  connection: () => Connection,
  fetcher: typeof fetch = fetch
): () => Promise<boolean> {
  return async () => {
    const auth = { ...connection() }
    if (!auth.token) return false
    try {
      const response = await fetcher(`${auth.baseUrl}/api/sync/account`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.token}` },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) return false
      const result: unknown = await response.json()
      const current = connection()
      if (
        current.token !== auth.token ||
        current.baseUrl !== auth.baseUrl ||
        current.revision !== auth.revision
      )
        return false
      return (
        result !== null &&
        typeof result === 'object' &&
        !Array.isArray(result) &&
        'remoteMcpEligible' in result &&
        result.remoteMcpEligible === true
      )
    } catch {
      return false
    }
  }
}
