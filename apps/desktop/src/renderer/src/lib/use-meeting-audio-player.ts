import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { MeetingTranscriptSegment as TranscriptSegment } from '@repo/meetings-store/types'
import type { AudioApi, AudioPart } from '../../../shared/audio-api'

interface MeetingAudioPlayer {
  audioParts: AudioPart[]
  setAudioParts: (parts: AudioPart[]) => void
  activePart: number
  playerSrc: string | null
  audioRef: RefObject<HTMLAudioElement | null>
  selectPart: (url: string) => void
  seekToSegment: (segment: TranscriptSegment) => void
  onLoadedMetadata: () => void
  advance: () => boolean
}

/** Own the selected recording and its blob for one mounted meeting. */
export function useMeetingAudioPlayer(audio: Pick<AudioApi, 'read'>): MeetingAudioPlayer {
  const [{ parts: audioParts, selectedUrl }, setSelection] = useState<{
    parts: AudioPart[]
    selectedUrl: string | null
  }>({ parts: [], selectedUrl: null })
  const setAudioParts = useCallback((parts: AudioPart[]): void => {
    setSelection((current) => ({
      parts,
      // Recovery may insert an older session. Keep the recording, not its index.
      // If it was removed (or this is the first load), use the first remaining part.
      selectedUrl: parts.some((part) => part.url === current.selectedUrl)
        ? current.selectedUrl
        : (parts[0]?.url ?? null)
    }))
  }, [])
  const activePart = audioParts.findIndex((part) => part.url === selectedUrl)
  const audioRef = useRef<HTMLAudioElement>(null)
  const pendingSeek = useRef<{ url: string; seconds: number } | null>(null)
  const [loaded, setLoaded] = useState<{ url: string; src: string } | null>(null)
  const playerSrc = loaded?.url === selectedUrl ? loaded.src : null

  // Electron custom-protocol media loading is unreliable. Read a recording once
  // into a random-access blob; metadata/list refreshes must not replace that src.
  useEffect(() => {
    if (pendingSeek.current?.url !== selectedUrl) pendingSeek.current = null
    // Clear a previous lease, including A → B → A while B's read is pending.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(null)
    if (!selectedUrl) return
    let objectUrl: string | null = null
    let cancelled = false
    audio
      .read(selectedUrl)
      .then((data) => {
        if (cancelled || !data) return
        objectUrl = URL.createObjectURL(new Blob([data.bytes as BlobPart], { type: data.mime }))
        setLoaded({ url: selectedUrl, src: objectUrl })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selectedUrl, audio])

  const seekPart = (url: string, seconds: number): void => {
    const el = audioRef.current
    if (url === selectedUrl && playerSrc && el?.currentSrc === playerSrc && el.readyState >= 1) {
      pendingSeek.current = null
      el.currentTime = seconds
      void el.play()
    } else {
      pendingSeek.current = { url, seconds }
      setSelection((current) => ({ ...current, selectedUrl: url }))
    }
  }

  const selectPart = (url: string): void => {
    if (!audioParts.some((part) => part.url === url)) return
    audioRef.current?.pause()
    seekPart(url, 0)
  }

  // A transcript's absolute time selects the latest part starting before it.
  // Cloud-stripped timestamps fall back to channel-relative time in this part.
  const seekToSegment = (segment: TranscriptSegment): void => {
    if (segment.source === 'text' || activePart < 0) return
    let part = audioParts[activePart]!
    let seconds = Math.max(0, segment.startMs / 1000)
    const abs = segment.absoluteStartMs
    if (typeof abs === 'number') {
      part = audioParts[0]!
      for (let i = audioParts.length - 1; i >= 0; i--) {
        if (audioParts[i]!.startEpochMs <= abs) {
          part = audioParts[i]!
          break
        }
      }
      seconds = Math.max(0, (abs - part.startEpochMs) / 1000)
    }
    seekPart(part.url, seconds)
  }

  const onLoadedMetadata = (): void => {
    const seek = pendingSeek.current
    const el = audioRef.current
    if (
      seek?.url === selectedUrl &&
      playerSrc &&
      el?.currentSrc === playerSrc &&
      el.readyState >= 1
    ) {
      pendingSeek.current = null
      el.currentTime = seek.seconds
      void el.play()
    }
  }

  const advance = (): boolean => {
    const next = audioParts[activePart + 1]
    if (activePart < 0 || !next) return false
    seekPart(next.url, 0)
    return true
  }

  return {
    audioParts,
    setAudioParts,
    activePart,
    playerSrc,
    audioRef,
    selectPart,
    seekToSegment,
    onLoadedMetadata,
    advance
  }
}
