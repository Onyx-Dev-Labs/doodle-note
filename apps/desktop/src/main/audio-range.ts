/**
 * HTTP Range parsing for the doodle-audio:// protocol. Pure logic, split from
 * audio-service so it can be unit-tested without importing Electron.
 */

export interface ByteRange {
  start: number
  end: number
}

/**
 * Parse a `Range` header against a file of `size` bytes.
 * Returns null for "no/unusable range" (serve the whole file) and
 * 'unsatisfiable' when the request is past EOF (respond 416).
 * Only the single-range `bytes=start-[end]` form is supported — it's the only
 * one Chromium's media stack sends.
 */
export function parseByteRange(
  header: string | null,
  size: number
): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  const match = /^bytes=(\d+)-(\d*)$/.exec(header)
  if (!match) return null
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}
