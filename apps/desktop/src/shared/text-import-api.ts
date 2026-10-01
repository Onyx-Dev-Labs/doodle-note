import type { TextTranscriptSegment } from '@repo/meetings-store/types'

export const TEXT_IMPORT_PREVIEW = 'text-import:preview'
export const TEXT_IMPORT_COMMIT = 'text-import:commit'
export const TEXT_IMPORT_CANCEL = 'text-import:cancel'

export interface TextImportPreview {
  token: string
  title: string
  fileName: string
  segments: TextTranscriptSegment[]
}
export interface TextImporterApi {
  preview(): Promise<{ preview?: TextImportPreview; error?: string; canceled?: boolean }>
  commit(token: string): Promise<{ meetingId?: string; error?: string }>
  cancel(token: string): Promise<void>
}
