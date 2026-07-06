import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ipcMain, net, protocol } from 'electron'
import {
  MEDIA_ACCEPTED_MIME,
  MEDIA_SAVE_CHANNEL,
  type MediaSaveRequest,
  type MediaSaveResult
} from '../shared/media-api'

/** Images pasted into notes; generous but bounded. */
const MAX_BYTES = 15 * 1024 * 1024

/** Served names are uuid.ext only — the protocol handler enforces this. */
const SAFE_NAME = /^[a-z0-9-]+\.[a-z0-9]+$/

/**
 * Local image attachments for the notes editor. Files live in
 * userData/attachments and are served to the renderer over the
 * doodle-media:// protocol (works in dev where the renderer is http and
 * file:// would be blocked, and in the packaged app alike).
 */
export class MediaService {
  constructor(private readonly dir: string) {}

  registerIpc(): void {
    ipcMain.handle(MEDIA_SAVE_CHANNEL, (_event, request: unknown) =>
      this.save(request as Partial<MediaSaveRequest>)
    )
  }

  /** Call after app ready (protocol.handle requires it). */
  registerProtocol(): void {
    protocol.handle('doodle-media', (request) => {
      // doodle-media://<uuid>.<ext> — the name parses as the URL host.
      const name = new URL(request.url).host
      if (!SAFE_NAME.test(name)) return new Response('bad name', { status: 400 })
      return net.fetch(pathToFileURL(join(this.dir, name)).toString())
    })
  }

  private save(request: Partial<MediaSaveRequest>): MediaSaveResult {
    const mime = typeof request.mime === 'string' ? request.mime : ''
    const ext = MEDIA_ACCEPTED_MIME[mime]
    if (!ext) return { error: `Unsupported image type: ${mime || 'unknown'}` }
    const bytes = request.bytes
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
      return { error: 'Empty image' }
    }
    if (bytes.byteLength > MAX_BYTES) {
      return { error: 'Image is too large (15 MB max)' }
    }
    try {
      mkdirSync(this.dir, { recursive: true })
      const name = `${randomUUID()}.${ext}`
      writeFileSync(join(this.dir, name), Buffer.from(bytes))
      return { url: `doodle-media://${name}` }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not save image' }
    }
  }
}
