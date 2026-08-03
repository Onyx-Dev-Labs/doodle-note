export interface HistoryItem {
  createdAt: string
}

export interface MeetingHistoryWindow<T> {
  displayed: T[]
  totalOlder: number
  hiddenOlder: number
  shownOlder: number
}

const DAY_MS = 86_400_000

function localStartOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Keep the recent Home view compact while revealing older items in bounded batches. */
export function meetingHistoryWindow<T extends HistoryItem>(
  items: readonly T[],
  options: { nowMs?: number; recentDays?: number; olderVisibleCount?: number } = {}
): MeetingHistoryWindow<T> {
  const recentDays = Math.max(1, Math.floor(options.recentDays ?? 7))
  const olderVisibleCount = Math.max(0, Math.floor(options.olderVisibleCount ?? 0))
  const cutoff = localStartOfDay(options.nowMs ?? Date.now()) - (recentDays - 1) * DAY_MS
  const recent: T[] = []
  const older: T[] = []

  for (const item of items) {
    const createdMs = Date.parse(item.createdAt)
    if (Number.isFinite(createdMs) && createdMs >= cutoff) recent.push(item)
    else older.push(item)
  }

  const shownOlder = Math.min(olderVisibleCount, older.length)
  return {
    displayed: [...recent, ...older.slice(0, shownOlder)],
    totalOlder: older.length,
    hiddenOlder: older.length - shownOlder,
    shownOlder
  }
}
