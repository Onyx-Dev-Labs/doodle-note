export const MEDIA_SAVE_CHANNEL = 'media:save'

/** Mime types the editor accepts; anything else is rejected on save. */
export const MEDIA_ACCEPTED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export interface MediaSaveRequest {
  /** Raw file bytes (structured-clone transfers ArrayBuffer over IPC). */
  bytes: ArrayBuffer
  mime: string
}

export type MediaSaveResult = { url: string } | { error: string }

export interface MediaApi {
  /** Persist an image to the local attachments store; returns a doodle-media:// URL. */
  save(request: MediaSaveRequest): Promise<MediaSaveResult>
}
