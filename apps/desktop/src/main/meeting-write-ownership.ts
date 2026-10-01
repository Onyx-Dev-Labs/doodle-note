import type { MeetingUpsert } from '@repo/meetings-store'

/** Capture/import services own transcript content; renderer edits own notes and metadata. */
export function rendererMeetingPatch(patch: MeetingUpsert): MeetingUpsert {
  const metadata = { ...patch }
  delete metadata.segments
  delete metadata.echoSuppressed
  return metadata
}
