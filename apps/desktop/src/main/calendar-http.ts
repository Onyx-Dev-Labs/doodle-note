import type { CalendarProvider } from '../shared/calendar-api'

export class CalendarRequestError extends Error {
  constructor(
    message: string,
    readonly retryAt?: number
  ) {
    super(message)
  }
}

export async function mapCalendarTasks<T, R>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(values.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const i = next++
        results[i] = await task(values[i]!)
      }
    })
  )
  return results
}

/** Complete one list or throw; never hand a truncated list to cache replacement. */
export async function calendarPages(
  initial: string,
  token: string,
  provider: CalendarProvider,
  headers: Record<string, string> = {},
  signal?: AbortSignal
): Promise<unknown[]> {
  const base = new URL(initial)
  const origin =
    provider === 'microsoft' ? 'https://graph.microsoft.com' : 'https://www.googleapis.com'
  const label = provider === 'microsoft' ? 'Microsoft' : 'Google'
  const seen = new Set<string>()
  const items: unknown[] = []
  let next: string | undefined = initial
  for (let page = 0; next; page++) {
    const url = new URL(next)
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== base.pathname
    )
      throw new CalendarRequestError(`${label} Calendar returned an unsafe pagination destination.`)
    if (seen.has(url.href))
      throw new CalendarRequestError(`${label} Calendar repeated a page. Retry sync.`)
    if (page >= 100)
      throw new CalendarRequestError(
        `${label} Calendar exceeded 100 pages. Narrow your calendar selection and retry.`
      )
    seen.add(url.href)
    let response: Response | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted()
      try {
        response = await fetch(url.href, {
          headers: { ...headers, Authorization: `Bearer ${token}` },
          redirect: 'error',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
            : AbortSignal.timeout(20_000)
        })
      } catch {
        throw new CalendarRequestError(
          `${label} Calendar could not be reached. Check your connection and retry.`
        )
      }
      if (response.ok) break
      let retryable = [429, 500, 502, 503, 504].includes(response.status)
      if (provider === 'google' && response.status === 403) {
        const detail = (await response.json().catch(() => null)) as {
          error?: { errors?: { reason?: string }[] }
        } | null
        retryable = !!detail?.error?.errors?.some((error) =>
          ['rateLimitExceeded', 'userRateLimitExceeded'].includes(error.reason ?? '')
        )
      }
      if (!retryable) {
        throw new CalendarRequestError(
          response.status === 401
            ? `${label} Calendar needs you to reconnect this account.`
            : response.status === 403
              ? `${label} Calendar access was denied. Check this account's permissions.`
              : `${label} Calendar request failed (HTTP ${response.status}).`
        )
      }
      const retry = response.headers.get('retry-after')
      const delay = retry
        ? /^\d+(\.\d+)?$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now()
        : 1000 * 2 ** attempt
      const wait = Number.isFinite(delay) ? Math.max(0, delay) : 1000 * 2 ** attempt
      if (attempt === 2 || wait > 5000)
        throw new CalendarRequestError(
          `${label} Calendar is temporarily limited. Retry after ${new Date(Date.now() + wait).toLocaleTimeString()}.`,
          Date.now() + wait
        )
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => {
          clearTimeout(timer)
          reject(new Error('Calendar sync cancelled.'))
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', abort)
          resolve()
        }, wait)
        signal?.addEventListener('abort', abort, { once: true })
      })
    }
    const body = (await response!.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object')
      throw new CalendarRequestError(`${label} Calendar returned an invalid page.`)
    const list = provider === 'microsoft' ? body.value : (body.items ?? [])
    if (!Array.isArray(list))
      throw new CalendarRequestError(`${label} Calendar returned an invalid page.`)
    items.push(...list)
    if (items.length > 10_000)
      throw new CalendarRequestError(
        `${label} Calendar exceeded 10,000 results. Narrow your calendar selection and retry.`
      )
    const cursor = provider === 'microsoft' ? body['@odata.nextLink'] : body.nextPageToken
    if (cursor != null && typeof cursor !== 'string')
      throw new CalendarRequestError(`${label} Calendar returned an invalid page token.`)
    if (!cursor) next = undefined
    else if (provider === 'microsoft') next = cursor as string
    else {
      const following = new URL(initial)
      following.searchParams.set('pageToken', cursor as string)
      next = following.href
    }
  }
  return items
}
