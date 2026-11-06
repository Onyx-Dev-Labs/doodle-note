import { useEffect, useRef, useState } from 'react'
import {
  VOICE_ENROLL_SECONDS,
  type DictationSettingsUpdate,
  type DictationStatus,
  type VoiceEnrollOutcome
} from '../../shared/dictation-api'
import { FEATURE_NAME } from '../../shared/dictation-brand'
import { Toggle } from './ModelsView'

interface Props {
  status: DictationStatus
  update: (patch: DictationSettingsUpdate) => Promise<void>
}

/** prompt: the switch was turned on with no voice yet, and the page is asking for a recording. */
type Phase = 'idle' | 'prompt' | 'preparing' | 'recording' | 'analysing'

/** About twenty seconds at an unhurried reading pace. */
const PASSAGE =
  'Most mornings I make a cup of coffee and look over what I want to get done. ' +
  'I answer a few messages, check my calendar, and pick the one thing that matters most. ' +
  'When I need to think, I talk it through out loud, and my notes keep up with me. ' +
  'By the afternoon I like to step outside, stretch my legs, and come back with a clear head.'

/** The recording can be ended early once it holds enough speech to learn from. */
const EARLY_FINISH_SECONDS = 10

const FAILURES: Record<Exclude<VoiceEnrollOutcome, { ok: true }>['reason'], string> = {
  busy: 'The microphone is in use by a dictation or a meeting. Try again when it is free.',
  microphone:
    'Microphone access is off. Turn it on in System Settings → Privacy & Security → Microphone.',
  'not-enough-speech':
    'That was not enough of your voice to learn from. Read the whole passage aloud at your normal speaking volume.',
  cancelled: '',
  unavailable: 'Voice setup is not available on this Mac.',
  failed: 'Could not learn your voice. Try again.'
}

function recordedOn(createdAt: number): string {
  if (!createdAt) return ''
  return new Date(createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/**
 * "Only my voice": a switch. Turning it on for the first time asks for a short
 * recording so the app can learn the voice; after that it is an ordinary switch.
 */
export function DictationVoiceSettings({ status, update }: Props): React.JSX.Element {
  const { settings, voice } = status
  const [phase, setPhase] = useState<Phase>('idle')
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [message, setMessage] = useState('')
  const startedAt = useRef(0)

  useEffect(
    () =>
      window.dictation.onVoiceEvent((event) => {
        switch (event.type) {
          case 'preparing':
            // Already showing "Getting ready" since the click. The voice model can
            // still be downloading once the microphone is open, so this never
            // moves the view back.
            break
          case 'recording':
            startedAt.current = Date.now()
            setElapsed(0)
            setPhase('recording')
            break
          case 'level':
            setLevel(event.level)
            break
          case 'analysing':
            setPhase('analysing')
            break
        }
      }),
    []
  )

  useEffect(() => {
    if (phase !== 'recording') return
    const timer = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 200)
    return () => clearInterval(timer)
  }, [phase])

  const record = async (): Promise<void> => {
    setMessage('')
    setLevel(0)
    setPhase('preparing')
    try {
      const outcome = await window.dictation.enrollVoice()
      setMessage(
        outcome.ok
          ? `${FEATURE_NAME} knows your voice now, and Only my voice is on.`
          : FAILURES[outcome.reason]
      )
    } catch {
      setMessage(FAILURES.failed)
    } finally {
      setPhase('idle')
    }
  }

  const remove = async (): Promise<void> => {
    setMessage('')
    try {
      await window.dictation.removeVoice()
    } catch {
      setMessage('Could not remove your voice.')
    }
  }

  const toggle = (): void => {
    setMessage('')
    if (phase === 'prompt') {
      setPhase('idle') // changed their mind before recording
    } else if (voice) {
      void update({ onlyMyVoice: !settings.onlyMyVoice })
    } else {
      // Nothing to filter by yet: ask for the recording first. It switches on when that succeeds.
      setPhase('prompt')
    }
  }

  const recorded = voice ? recordedOn(voice.createdAt) : ''
  const remaining = Math.max(0, Math.ceil(VOICE_ENROLL_SECONDS - elapsed))
  const busy = phase === 'preparing' || phase === 'recording' || phase === 'analysing'
  // On once there is a voice to filter by; shown on while the first recording is being made.
  const on = voice ? settings.onlyMyVoice : phase !== 'idle'

  return (
    <>
      <div className="cal-row">
        <span className="cal-row-main">
          <span className="cal-row-label">Only my voice</span>
          <span className="cal-row-sub">
            {voice
              ? `Anyone else talking near your microphone is left out of what you dictate. Words appear on the pill about half a second later while ${FEATURE_NAME} checks whose voice it is.`
              : `Leaves out anyone talking near your microphone. The first time you turn it on, ${FEATURE_NAME} asks you to read aloud for about twenty seconds so it can learn your voice.`}
          </span>
        </span>
        <Toggle checked={on} label="Only transcribe my voice" disabled={busy} onChange={toggle} />
      </div>

      {phase === 'prompt' && (
        <div className="cal-row voice-setup" role="group" aria-label="Record your voice">
          <span className="cal-row-main">
            <span className="cal-row-label">First, {FEATURE_NAME} needs to learn your voice</span>
            <span className="cal-row-sub">
              You will read a short passage aloud for about twenty seconds, using the microphone you
              dictate with. What {FEATURE_NAME} learns stays on this Mac, and the recording is not
              kept.
            </span>
          </span>
          <button type="button" className="pill-btn" onClick={() => void record()}>
            Start recording
          </button>
          <button type="button" className="pill-btn" onClick={() => setPhase('idle')}>
            Not now
          </button>
        </div>
      )}

      {busy && (
        <div className="cal-row voice-setup" role="group" aria-label="Recording your voice">
          <span className="cal-row-main">
            <span className="cal-row-label" aria-live="polite">
              {phase === 'recording'
                ? 'Read this aloud, the way you normally speak'
                : phase === 'analysing'
                  ? 'Learning your voice…'
                  : 'Getting ready…'}
            </span>
            <span className="voice-passage">{PASSAGE}</span>
            <span className="voice-meter" aria-hidden="true">
              <span
                style={{ width: `${Math.round((phase === 'recording' ? level : 0) * 100)}%` }}
              />
            </span>
            <span className="cal-row-sub">
              {phase === 'recording'
                ? `${remaining} second${remaining === 1 ? '' : 's'} left. Use the microphone you dictate with.`
                : phase === 'analysing'
                  ? 'This takes a few seconds.'
                  : 'The first time, this downloads a small voice model.'}
            </span>
          </span>
          {phase === 'recording' && (
            <button
              type="button"
              className="pill-btn"
              disabled={elapsed < EARLY_FINISH_SECONDS}
              onClick={() => void window.dictation.finishVoiceEnroll()}
            >
              I&apos;m done
            </button>
          )}
          {phase !== 'analysing' && (
            <button
              type="button"
              className="pill-btn"
              onClick={() => void window.dictation.cancelVoiceEnroll()}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {voice && phase === 'idle' && (
        <div className="cal-row">
          <span className="cal-row-main">
            <span className="cal-row-label">Your recorded voice</span>
            <span className="cal-row-sub">
              {recorded ? `Recorded ${recorded}` : 'Recorded'}
              {voice.deviceName ? ` with ${voice.deviceName}` : ''}. Record it again if you change
              microphones or {FEATURE_NAME} starts leaving out your own words.
            </span>
          </span>
          <button type="button" className="pill-btn" onClick={() => void record()}>
            Record again
          </button>
          <button type="button" className="pill-btn pill-danger" onClick={() => void remove()}>
            Remove
          </button>
        </div>
      )}

      {message && phase === 'idle' && (
        <div className="cal-row">
          <span className="cal-row-sub" role="status">
            {message}
          </span>
        </div>
      )}
    </>
  )
}
