import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CalendarState } from '../../shared/calendar-api'
import type { DetectState } from '../../shared/detect-api'
import type { NotesSettingsView } from '../../shared/notes-api'
import type { SyncStatus } from '../../shared/sync-api'
import mascotUrl from './assets/mascot-square.png'
import { CalendarIcon, CloudIcon, MicIcon, SparkleIcon } from './icons'
import { markOnboardingDone } from './lib/onboarding'

/**
 * First-run tour: a short, status-aware wizard that walks a new user
 * through the setup that makes DoodleNote sing — recording basics, calendar
 * connections, meeting detection (macOS), cloud sync, and the notes model.
 * Steps with live state show real checkmarks: connecting a calendar from
 * the wizard flips its step to done the moment the OAuth flow lands.
 *
 * Persistence is a localStorage flag (same pattern as the theme pref) —
 * closing the tour by any path marks it seen; Settings → General offers a
 * replay.
 */

type StepId = 'welcome' | 'record' | 'calendar' | 'detect' | 'sync' | 'model' | 'finish'

interface TourProps {
  calendar: CalendarState | null
  onOpenModelSettings: () => void
  onNewMeeting: () => void
  onClose: () => void
}

function OnboardingTour({
  calendar,
  onOpenModelSettings,
  onNewMeeting,
  onClose
}: TourProps): React.JSX.Element {
  const [detect, setDetect] = useState<DetectState | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [notes, setNotes] = useState<NotesSettingsView | null>(null)
  const [busy, setBusy] = useState<'ms' | 'google' | 'sync' | null>(null)
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.detect
      .getState()
      .then((s) => {
        if (!cancelled) setDetect(s)
      })
      .catch(() => {})
    void window.sync
      .getStatus()
      .then((s) => {
        if (!cancelled) setSync(s)
      })
      .catch(() => {})
    void window.notes
      .getSettings()
      .then((s) => {
        if (!cancelled) setNotes(s)
      })
      .catch(() => {})
    const offSync = window.sync.onStatus(setSync)
    return () => {
      cancelled = true
      offSync()
    }
  }, [])

  // The detect step only exists where mic-activity detection does (macOS).
  const steps = useMemo<StepId[]>(() => {
    const base: StepId[] = ['welcome', 'record', 'calendar']
    if (detect?.micDetectSupported !== false) base.push('detect')
    base.push('sync', 'model', 'finish')
    return base
  }, [detect])
  const step = steps[Math.min(stepIndex, steps.length - 1)]!

  const finish = useCallback(() => {
    markOnboardingDone()
    onClose()
  }, [onClose])

  // Escape closes (and never shows again) — the tour is a guide, not a gate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [finish])

  const connectMs = useCallback(async () => {
    setBusy('ms')
    try {
      await window.calendar.connect()
    } finally {
      setBusy(null)
    }
  }, [])

  const connectGoogle = useCallback(async () => {
    setBusy('google')
    try {
      await window.calendar.connectGoogle()
    } finally {
      setBusy(null)
    }
  }, [])

  const connectSync = useCallback(async () => {
    setBusy('sync')
    try {
      setSync(await window.sync.connect())
    } finally {
      setBusy(null)
    }
  }, [])

  const setDetectPref = useCallback(
    async (update: { loginItem?: boolean; micDetect?: boolean; autoStop?: boolean }) => {
      setDetect(await window.detect.setPrefs(update))
    },
    []
  )

  const calendarConnected = calendar?.msSignedIn === true || calendar?.googleSignedIn === true
  const detectionOn = detect?.micDetect === true
  const syncConnected = sync?.connected === true
  const modelReady =
    notes !== null &&
    (notes.engineChoice === 'cloud'
      ? notes.cloud?.hasKey === true
      : typeof notes.activeLocalModelId === 'string' && notes.activeLocalModelId.length > 0)
  const isWindows = detect?.platform === 'win32'

  const next = (): void => setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  const back = (): void => setStepIndex((i) => Math.max(i - 1, 0))

  return (
    <div className="tour-overlay no-drag" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="tour-card">
        <button type="button" className="tour-skip" onClick={finish}>
          Skip tour
        </button>

        {step === 'welcome' && (
          <div className="tour-body">
            <img className="tour-mascot" src={mascotUrl} alt="" draggable={false} />
            <h2 className="tour-title">Welcome to DoodleNote</h2>
            <p className="tour-lede">
              Your meetings, transcribed and summarized — right on this computer, with no bot
              joining your calls. Two minutes of setup gets you the full experience.
            </p>
            <ul className="tour-points">
              <li>
                <MicIcon size={14} /> Captures your mic and the other side of the call, natively
              </li>
              <li>
                <SparkleIcon size={14} /> Turns rough notes + transcript into polished summaries
              </li>
              <li>
                <CloudIcon size={14} /> Local &amp; private by default — cloud sync is opt-in
              </li>
            </ul>
          </div>
        )}

        {step === 'record' && (
          <div className="tour-body">
            <h2 className="tour-title">Recording a meeting</h2>
            <p className="tour-lede">
              Hit <strong>+ New meeting</strong> and recording starts instantly. Talk normally — the
              transcript builds live, labeling your mic &ldquo;You&rdquo; and the call audio
              &ldquo;Them.&rdquo; Works with Zoom, Teams, Meet, or anything else that makes sound.
            </p>
            <ul className="tour-points">
              <li>Take rough notes while you talk — bullets, fragments, half-thoughts are fine</li>
              <li>
                When the meeting ends, <strong>Generate notes</strong> merges your notes with the
                transcript into a clean summary
              </li>
              <li>
                {isWindows
                  ? 'First recording asks for microphone permission, and the speech model finishes downloading on first launch'
                  : 'First recording asks for microphone and system-audio permission — one-time macOS prompts'}
              </li>
            </ul>
          </div>
        )}

        {step === 'calendar' && (
          <div className="tour-body">
            <span className="tour-glyph">
              <CalendarIcon size={22} />
            </span>
            <h2 className="tour-title">Connect your calendar</h2>
            <p className="tour-lede">
              See what&rsquo;s coming up, and get a &ldquo;start taking notes?&rdquo; nudge the
              moment a meeting begins — pre-titled from the event.
            </p>
            {calendarConnected ? (
              <p className="tour-done">✓ Calendar connected — you&rsquo;re set here.</p>
            ) : (
              <div className="tour-actions-row">
                <button
                  type="button"
                  className="tour-action"
                  disabled={busy !== null}
                  onClick={() => void connectMs()}
                >
                  {busy === 'ms' ? 'Waiting for browser…' : 'Connect Microsoft 365'}
                </button>
                <button
                  type="button"
                  className="tour-action"
                  disabled={busy !== null}
                  onClick={() => void connectGoogle()}
                >
                  {busy === 'google' ? 'Waiting for browser…' : 'Connect Google'}
                </button>
              </div>
            )}
            <p className="tour-footnote">Optional — you can always start meetings by hand.</p>
          </div>
        )}

        {step === 'detect' && (
          <div className="tour-body">
            <span className="tour-glyph">
              <MicIcon size={22} />
            </span>
            <h2 className="tour-title">Never miss a meeting</h2>
            <p className="tour-lede">
              DoodleNote can notice when a call starts — even ad-hoc ones that aren&rsquo;t on your
              calendar — and offer to take notes. It can also stop recording by itself when the call
              ends.
            </p>
            <div className="tour-toggle-row">
              <span>Detect meetings from mic activity</span>
              <button
                type="button"
                role="switch"
                aria-checked={detect?.micDetect === true}
                aria-label="Detect meetings from mic activity"
                className={detect?.micDetect ? 'toggle on' : 'toggle'}
                onClick={() => void setDetectPref({ micDetect: !(detect?.micDetect ?? false) })}
              >
                <span className="toggle-knob" aria-hidden="true" />
              </button>
            </div>
            <div className="tour-toggle-row">
              <span>Stop recording when the meeting ends</span>
              <button
                type="button"
                role="switch"
                aria-checked={detect?.autoStop === true}
                aria-label="Stop recording when the meeting ends"
                className={detect?.autoStop ? 'toggle on' : 'toggle'}
                onClick={() => void setDetectPref({ autoStop: !(detect?.autoStop ?? false) })}
              >
                <span className="toggle-knob" aria-hidden="true" />
              </button>
            </div>
            <div className="tour-toggle-row">
              <span>Start DoodleNote when you log in</span>
              <button
                type="button"
                role="switch"
                aria-checked={detect?.loginItem === true}
                aria-label="Start DoodleNote when you log in"
                className={detect?.loginItem ? 'toggle on' : 'toggle'}
                onClick={() => void setDetectPref({ loginItem: !(detect?.loginItem ?? false) })}
              >
                <span className="toggle-knob" aria-hidden="true" />
              </button>
            </div>
            {detectionOn && (
              <p className="tour-footnote">
                Tip: launch at login keeps detection watching even before you open the app.
              </p>
            )}
          </div>
        )}

        {step === 'sync' && (
          <div className="tour-body">
            <span className="tour-glyph">
              <CloudIcon size={22} />
            </span>
            <h2 className="tour-title">Cloud sync &amp; sharing</h2>
            <p className="tour-lede">
              Everything works offline. Connect the cloud when you want your meetings on the web
              dashboard, searchable from any device, and shareable with a link.
            </p>
            {syncConnected ? (
              <p className="tour-done">
                ✓ Synced{sync?.email ? ` as ${sync.email}` : ''} — your meetings back up
                automatically.
              </p>
            ) : (
              <div className="tour-actions-row">
                <button
                  type="button"
                  className="tour-action"
                  disabled={busy !== null || sync?.linking === true}
                  onClick={() => void connectSync()}
                >
                  {busy === 'sync' || sync?.linking ? 'Waiting for browser…' : 'Connect cloud sync'}
                </button>
              </div>
            )}
            <p className="tour-footnote">Optional and off by default — local-first, always.</p>
          </div>
        )}

        {step === 'model' && (
          <div className="tour-body">
            <span className="tour-glyph">
              <SparkleIcon size={22} />
            </span>
            <h2 className="tour-title">Pick your notes model</h2>
            <p className="tour-lede">
              Generate notes needs an AI model: download a local one that runs entirely on this
              computer, or plug in your own Anthropic/OpenAI key for cloud-quality summaries.
            </p>
            {modelReady ? (
              <p className="tour-done">
                ✓ {notes?.engineChoice === 'cloud' ? 'Cloud key saved' : 'Local model ready'} —
                Generate notes is good to go.
              </p>
            ) : (
              <div className="tour-actions-row">
                <button
                  type="button"
                  className="tour-action"
                  onClick={() => {
                    markOnboardingDone()
                    onOpenModelSettings()
                    onClose()
                  }}
                >
                  Choose a model in Settings
                </button>
              </div>
            )}
            <p className="tour-footnote">
              Recording and transcription work without this — it&rsquo;s only for generated
              summaries.
            </p>
          </div>
        )}

        {step === 'finish' && (
          <div className="tour-body">
            <img className="tour-mascot" src={mascotUrl} alt="" draggable={false} />
            <h2 className="tour-title">You&rsquo;re all set</h2>
            <ul className="tour-checklist">
              <li className={calendarConnected ? 'done' : ''}>
                {calendarConnected ? '✓' : '○'} Calendar{' '}
                {calendarConnected ? 'connected' : 'not connected'}
              </li>
              {detect?.micDetectSupported !== false && (
                <li className={detectionOn ? 'done' : ''}>
                  {detectionOn ? '✓' : '○'} Meeting detection {detectionOn ? 'on' : 'off'}
                </li>
              )}
              <li className={syncConnected ? 'done' : ''}>
                {syncConnected ? '✓' : '○'} Cloud sync {syncConnected ? 'on' : 'off'}
              </li>
              <li className={modelReady ? 'done' : ''}>
                {modelReady ? '✓' : '○'} Notes model {modelReady ? 'ready' : 'not set up'}
              </li>
            </ul>
            <p className="tour-footnote">
              Anything you skipped lives in Settings — and this tour replays from Settings →
              General.
            </p>
          </div>
        )}

        <div className="tour-footer">
          <div className="tour-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s} className={i === stepIndex ? 'tour-dot on' : 'tour-dot'} />
            ))}
          </div>
          <div className="tour-nav">
            {stepIndex > 0 && (
              <button type="button" className="tour-back" onClick={back}>
                Back
              </button>
            )}
            {step === 'finish' ? (
              <button
                type="button"
                className="tour-next"
                onClick={() => {
                  finish()
                  onNewMeeting()
                }}
              >
                Start your first meeting
              </button>
            ) : (
              <button type="button" className="tour-next" onClick={next}>
                {step === 'welcome' ? 'Show me around' : 'Next'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default OnboardingTour
