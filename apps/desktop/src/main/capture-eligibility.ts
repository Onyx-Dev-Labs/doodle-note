import type { MeetingRecord } from '@repo/meetings-store'

/** Reject text-only records before reserving capture or opening any audio resources. */
export function beginRecordableMeeting(
  record: MeetingRecord | null,
  begin: () => boolean,
  reject: (message: string) => void
): boolean {
  if (record?.segments.some((segment) => segment.source === 'text')) {
    reject('This is an imported text transcript. Create a new meeting to record audio.')
    return false
  }
  return begin()
}
