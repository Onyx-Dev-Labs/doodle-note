import { useEffect, useId, useRef, useState } from 'react'
import type { CitationView, CitedAudioPlayback } from '../../shared/cited-ask-api'

export interface OriginalPassagePanelProps {
  view: CitationView | null
  onClose(): void
  /** Consumer calls its own IPC, which revalidates current request + source + opaque token. */
  onPlayAudio?(token: string): Promise<CitedAudioPlayback>
}
/** Shared Home/brief navigation: exact original text, never editor offsets or generated text. */
export default function OriginalPassagePanel(
  props: OriginalPassagePanelProps
): React.JSX.Element | null {
  if (!props.view) return null
  const view = props.view
  const identity =
    view.status === 'resolved'
      ? view.range.id + (view.audio.status === 'available' ? view.audio.token : view.audio.status)
      : view.status
  return <PassageDialog key={identity} {...props} view={view} />
}
function PassageDialog({
  view,
  onClose,
  onPlayAudio
}: Omit<OriginalPassagePanelProps, 'view'> & { view: CitationView }): React.JSX.Element {
  const heading = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const sequence = useRef({ value: 0 })
  const url = useRef<string | null>(null)
  const [playback, setPlayback] = useState<{ url: string; seek: number; token: string } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const modal = dialog.current
    modal?.showModal()
    return () => {
      modal?.close()
      previous?.focus()
    }
  }, [])
  useEffect(() => {
    const counter = sequence.current
    counter.value++
    const player = audio.current
    return () => {
      counter.value++
      player?.pause()
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = null
    }
  }, [])
  const token =
    view.status === 'resolved' && view.audio.status === 'available' ? view.audio.token : null
  const play = async (): Promise<void> => {
    if (!token || !onPlayAudio || loading) return
    const ticket = ++sequence.current.value
    setLoading(true)
    setError(null)
    try {
      const result = await onPlayAudio(token)
      if (ticket !== sequence.current.value) return
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = URL.createObjectURL(
        new Blob([new Uint8Array(result.bytes)], { type: result.mime })
      )
      setPlayback({ url: url.current, seek: result.seekSeconds, token })
    } catch (cause) {
      if (ticket === sequence.current.value)
        setError(cause instanceof Error ? cause.message : 'Audio is no longer available.')
    } finally {
      if (ticket === sequence.current.value) setLoading(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="original-passage-panel"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header>
        <h2 id={heading}>Original passage</h2>
        <button type="button" onClick={onClose} aria-label="Close original passage">
          Close
        </button>
      </header>
      {view.status !== 'resolved' ? (
        <p role="status">{view.reason}</p>
      ) : (
        <>
          <h3>{view.passage.title || 'Untitled meeting'}</h3>
          <p className="cited-meta">
            {view.occurredAt
              ? `${view.dateBasis === 'createdAt' ? 'Created' : 'Meeting'} ${new Date(view.occurredAt).toLocaleString()}`
              : 'Date unknown'}
          </p>
          <p className="cited-meta">
            {view.range.anchor.kind === 'personal' ? 'Personal notes' : 'Transcript'}
            {view.passage.speaker ? ` · ${view.passage.speaker}` : ''}
          </p>
          <div
            className="original-passage-text"
            tabIndex={0}
            aria-label="Read-only original passage"
          >
            {view.passage.text.slice(0, view.range.startUtf16)}
            <mark>{view.passage.text.slice(view.range.startUtf16, view.range.endUtf16)}</mark>
            {view.passage.text.slice(view.range.endUtf16)}
          </div>
          <p className="cited-meta">
            {view.range.anchor.kind === 'personal'
              ? 'The original personal Markdown is shown read-only.'
              : 'This is the original transcript segment.'}
          </p>
          {token && onPlayAudio ? (
            <button type="button" onClick={() => void play()} disabled={loading}>
              {loading ? 'Checking audio…' : 'Play near here'}
            </button>
          ) : (
            <p className="cited-meta">
              {view.audio.status === 'ambiguous'
                ? 'This passage cannot be mapped to one recording part.'
                : 'No reliable recording seek is available for this passage.'}
            </p>
          )}
          {playback && playback.token === token && (
            <audio
              ref={audio}
              controls
              src={playback.url}
              onLoadedMetadata={() => {
                const player = audio.current
                if (player) {
                  player.currentTime = playback.seek
                  void player
                    .play()
                    .catch(() => setError('Use the playback controls to play this recording.'))
                }
              }}
            />
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  )
}
