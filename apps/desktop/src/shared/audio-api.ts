/**
 * Meeting audio recordings: renderer-facing API surface.
 *
 * Audio is local-only by design — files live under userData/audio/<meetingId>/
 * and are never synced to the cloud. Each recording session within a meeting
 * produces one "part" (audio.m4a in its own session directory); most meetings
 * have exactly one.
 */

/**
 * Renderer localStorage key for the "save meeting audio" preference;
 * 'off' disables persistence (passed to the engine per session start).
 */
export const AUDIO_PERSIST_STORAGE_KEY = 'doodle.persistAudio'

/** System-audio capture backend. Default = the Core Audio process tap
 *  (audio-only permission, macOS 14.2+, engine self-probes and falls back
 *  automatically); 'sck' opts back into legacy ScreenCaptureKit capture. */
export const SYSTEM_BACKEND_STORAGE_KEY = 'doodle.systemBackend'

/** renderer → main (invoke): list a meeting's saved recordings. */
export const AUDIO_LIST_CHANNEL = 'audio:list'
/** renderer → main (invoke): read one recording's bytes for playback. */
export const AUDIO_READ_CHANNEL = 'audio:read'
/** renderer → main (invoke): delete one meeting's recordings. */
export const AUDIO_DELETE_CHANNEL = 'audio:delete'
/** renderer → main (invoke): delete every saved recording (Settings). */
export const AUDIO_CLEAR_ALL_CHANNEL = 'audio:clear-all'
/** renderer → main (invoke): total bytes across all recordings (Settings). */
export const AUDIO_USAGE_CHANNEL = 'audio:usage'

/** One saved recording session of a meeting. */
export interface AudioPart {
  /** doodle-audio:// URL playable by an <audio> element. */
  url: string
  /** Wall-clock ms of the recording's first frame (seek anchor). */
  startEpochMs: number
  /** 0 when unknown (the <audio> element learns it on load). */
  durationMs: number
}

export interface AudioUsage {
  totalBytes: number
  meetingCount: number
}

/** A recording's raw bytes + MIME, for blob-based playback in the renderer. */
export interface AudioFileData {
  bytes: Uint8Array
  mime: string
}

/** API surface exposed on `window.audio` by the preload script. */
export interface AudioApi {
  list(meetingId: string): Promise<AudioPart[]>
  /** Read a part (by its doodle-audio:// url) for playback; null = gone. */
  read(url: string): Promise<AudioFileData | null>
  deleteFor(meetingId: string): Promise<void>
  clearAll(): Promise<void>
  usage(): Promise<AudioUsage>
}
