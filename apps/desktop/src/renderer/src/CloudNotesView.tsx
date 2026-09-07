import type { JSX } from 'react'
import { Reader } from '@repo/cloud-reader'
import type { ReaderTransport, ReaderDetail, ReaderNote } from '@repo/cloud-reader/types'
const transport: ReaderTransport = {
  list: async (after) =>
    (await window.sync.reader({ kind: 'list', after })) as {
      notes: ReaderNote[]
      next: string | null
    },
  detail: async (query) => (await window.sync.reader({ kind: 'detail', query })) as ReaderDetail,
  action: async (value) =>
    (await window.sync.reader({ kind: 'action', value })) as { status: string },
  preview: async (note, revisionId, versionId) =>
    new Uint8Array(
      (await window.sync.reader({
        kind: 'preview',
        libraryId: note.libraryId,
        noteId: note.id,
        revisionId,
        versionId
      })) as Uint8Array
    )
}
export function CloudNotesView(): JSX.Element {
  return <Reader transport={transport} />
}
