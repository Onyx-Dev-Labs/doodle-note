import { extname } from 'node:path'

/** Recording containers accepted by the desktop import flow. */
export const IMPORTABLE_EXTENSIONS = ['wav', 'mp3', 'm4a', 'mp4'] as const

/** Local playback filenames that may exist inside one meeting session. */
export const AUDIO_FILES = ['audio.m4a', 'audio.wav', 'audio.mp3', 'audio.mp4'] as const

const AUDIO_MIME: Record<(typeof AUDIO_FILES)[number], string> = {
  'audio.m4a': 'audio/mp4',
  'audio.wav': 'audio/wav',
  'audio.mp3': 'audio/mpeg',
  'audio.mp4': 'video/mp4'
}

export function importedPlaybackFilename(sourcePath: string): (typeof AUDIO_FILES)[number] | null {
  const ext = extname(sourcePath).slice(1).toLowerCase()
  if (!(IMPORTABLE_EXTENSIONS as readonly string[]).includes(ext)) return null
  return `audio.${ext}` as (typeof AUDIO_FILES)[number]
}

export function playbackMime(filename: string): string {
  return AUDIO_MIME[filename as (typeof AUDIO_FILES)[number]] ?? 'application/octet-stream'
}
