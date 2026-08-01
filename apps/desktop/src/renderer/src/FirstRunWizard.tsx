import { useEffect, useRef, useState } from 'react'
import type { NotesModelInfo } from '../../shared/notes-api'
import type { WizardPreflightEvent } from '../../shared/wizard-api'
import mascotUrl from './assets/mascot-square.png'

/**
 * First-run setup: Welcome → Transcription (engine preflight, visible) →
 * Notes model (download or BYOK later) → Done. Everything is skippable and
 * nothing blocks — downloads keep running if the user finishes early. The
 * permissions prompts fire during the transcription step, front-loaded so
 * they never ambush someone's first real meeting.
 */

type Step = 'welcome' | 'engine' | 'notes' | 'done'

interface EngineState {
  status: 'running' | 'ready' | 'error'
  detail: string
  /** null = no download needed (cached) or not started. */
  progress: number | null
  mic: boolean | null
  screen: boolean | null
}

export default function FirstRunWizard({
  onFinish
}: {
  /** Called once, however the wizard ends (finish or skip). */
  onFinish: () => void
}): React.JSX.Element {
  const [step, setStep] = useState<Step>('welcome')
  const [isWindows, setIsWindows] = useState(false)

  useEffect(() => {
    void window.detect
      .getState()
      .then((state) => setIsWindows(state.platform === 'win32'))
      .catch(() => {})
  }, [])

  /* ---- engine step ---- */
  const [engine, setEngine] = useState<EngineState>({
    status: 'running',
    detail: 'Getting ready…',
    progress: null,
    mic: null,
    screen: null
  })
  const preflightStartedRef = useRef(false)

  useEffect(() => {
    if (step !== 'engine' || preflightStartedRef.current) return
    preflightStartedRef.current = true
    const unsubscribe = window.wizard.onPreflightEvent((ev: WizardPreflightEvent) => {
      setEngine((prev) => {
        switch (ev.stage) {
          case 'mic':
            return { ...prev, mic: ev.granted ?? false }
          case 'screen':
            return { ...prev, screen: ev.granted ?? false }
          case 'models':
            return { ...prev, detail: 'Preparing the transcription engine…' }
          case 'download':
            return {
              ...prev,
              detail: 'Downloading the transcription engine (~440 MB)…',
              progress: ev.progress ?? prev.progress
            }
          case 'ready':
            return { ...prev, status: 'ready', detail: 'Transcription is ready', progress: null }
          case 'error':
            return {
              ...prev,
              status: 'error',
              detail: ev.message ?? 'Setup hit a snag — you can finish later from Settings'
            }
          default:
            return prev
        }
      })
    })
    window.wizard.runPreflight().then((result) => {
      setEngine((prev) =>
        prev.status === 'running'
          ? {
              ...prev,
              status: result.ok ? 'ready' : 'error',
              detail: result.ok
                ? 'Transcription is ready'
                : (result.error ?? 'Setup hit a snag — you can finish later from Settings')
            }
          : prev
      )
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on entering the step
  }, [step])

  /* ---- notes model step ---- */
  const [models, setModels] = useState<NotesModelInfo[] | null>(null)
  const [notesState, setNotesState] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle')
  const [notesProgress, setNotesProgress] = useState(0)
  const [notesError, setNotesError] = useState<string | null>(null)

  useEffect(() => {
    if (step !== 'notes' || models !== null) return
    void window.notes
      .models()
      .then((response) => setModels(response.models))
      .catch(() => setModels([]))
  }, [step, models])

  useEffect(
    () =>
      window.notes.onDownloadProgress(({ progress }) => {
        setNotesProgress(progress)
      }),
    []
  )

  const recommended = models?.find((m) => m.available) ?? null
  const alreadyActive = models?.some((m) => m.downloaded) ?? false

  const downloadNotesModel = async (): Promise<void> => {
    if (!recommended) return
    setNotesState('downloading')
    setNotesError(null)
    try {
      const result = await window.notes.activateModel(recommended.id)
      if (result.ok) {
        setNotesState('done')
      } else {
        setNotesState('error')
        setNotesError(result.error ?? 'Download failed — you can retry from Settings.')
      }
    } catch (err) {
      setNotesState('error')
      setNotesError(err instanceof Error ? err.message : String(err))
    }
  }

  /* ---- shared bits ---- */

  const check = (ok: boolean | null): string => (ok === null ? '…' : ok ? '✓' : '✕')

  return (
    <div className="wizard-backdrop" role="dialog" aria-label="DoodleNote setup">
      <div className="wizard-card">
        <div className="wizard-steps" aria-hidden="true">
          {(['welcome', 'engine', 'notes', 'done'] as const).map((s, i) => (
            <span
              key={s}
              className={
                s === step
                  ? 'wizard-dot on'
                  : i < ['welcome', 'engine', 'notes', 'done'].indexOf(step)
                    ? 'wizard-dot done'
                    : 'wizard-dot'
              }
            />
          ))}
        </div>

        {step === 'welcome' && (
          <div className="wizard-body">
            <img src={mascotUrl} alt="" className="wizard-mascot" />
            <h1 className="wizard-title">
              Welcome to <span className="wz-ink">Doodle</span>
              <span className="wz-sage">Note</span>
            </h1>
            <p className="wizard-sub">Meeting notes that write themselves — all on your Mac.</p>
            <ul className="wizard-props">
              <li>No bot joins your calls — DoodleNote listens right on your Mac</li>
              <li>Transcription and AI notes run on-device. Nothing leaves your machine</li>
              <li>Works offline, no account needed</li>
            </ul>
            <button type="button" className="wizard-cta" onClick={() => setStep('engine')}>
              Get started
            </button>
            <p className="wizard-hint">Setup takes about two minutes.</p>
          </div>
        )}

        {step === 'engine' && (
          <div className="wizard-body">
            <h1 className="wizard-title">
              {isWindows ? 'Transcription' : 'Transcription & permissions'}
            </h1>
            <p className="wizard-sub">
              {isWindows ? (
                <>
                  The speech model downloads automatically in the background. Windows asks for
                  microphone and screen-audio access when your first recording starts.
                </>
              ) : (
                <>
                  macOS will ask for the <strong>microphone</strong> (your voice) and{' '}
                  <strong>system audio</strong> (the other side of the call) — no screen
                  recording, ever. Meanwhile the on-device transcription engine gets ready.
                </>
              )}
            </p>
            <div className="wizard-rows">
              {!isWindows && (
                <div className="wizard-row">
                  <span>Microphone access</span>
                  <span className={engine.mic === false ? 'wz-bad' : 'wz-ok'}>
                    {check(engine.mic)}
                  </span>
                </div>
              )}
              {!isWindows && (
                <div className="wizard-row">
                  <span>System audio</span>
                  <span className={engine.screen === false ? 'wz-bad' : 'wz-ok'}>
                    {check(engine.screen)}
                  </span>
                </div>
              )}
              <div className="wizard-row">
                <span>{isWindows ? 'Speech model prepares automatically' : engine.detail}</span>
                <span className={engine.status === 'error' ? 'wz-bad' : 'wz-ok'}>
                  {engine.status === 'ready' ? '✓' : engine.status === 'error' ? '✕' : '…'}
                </span>
              </div>
              {engine.progress !== null && (
                <progress className="wizard-progress" value={engine.progress} max={1} />
              )}
            </div>
            {!isWindows && (engine.mic === false || engine.screen === false) && (
              <p className="wizard-hint">
                Denied something? Grant it later in System Settings → Privacy &amp; Security →
                Microphone / Screen &amp; System Audio Recording — recording won&rsquo;t work
                until then.
              </p>
            )}
            <button
              type="button"
              className="wizard-cta"
              disabled={engine.status === 'running'}
              onClick={() => setStep('notes')}
            >
              {engine.status === 'running' ? 'Setting up…' : 'Continue'}
            </button>
          </div>
        )}

        {step === 'notes' && (
          <div className="wizard-body">
            <h1 className="wizard-title">Notes model</h1>
            <p className="wizard-sub">
              After a meeting, DoodleNote merges your rough notes with the transcript into polished
              notes — by default with a model that runs entirely on this Mac.
            </p>
            {alreadyActive || notesState === 'done' ? (
              <div className="wizard-rows">
                <div className="wizard-row">
                  <span>On-device notes model</span>
                  <span className="wz-ok">✓ ready</span>
                </div>
              </div>
            ) : recommended ? (
              <div className="wizard-rows">
                <div className="wizard-row">
                  <span>
                    {recommended.label} — {recommended.description}
                  </span>
                  <span>{recommended.sizeGB.toFixed(1)} GB</span>
                </div>
                {notesState === 'downloading' && (
                  <progress className="wizard-progress" value={notesProgress} max={1} />
                )}
                {notesError && <p className="wizard-hint wz-bad">{notesError}</p>}
                <button
                  type="button"
                  className="wizard-cta"
                  disabled={notesState === 'downloading'}
                  onClick={() => void downloadNotesModel()}
                >
                  {notesState === 'downloading'
                    ? `Downloading… ${Math.round(notesProgress * 100)}%`
                    : 'Download the model'}
                </button>
              </div>
            ) : (
              <p className="wizard-hint">
                {models === null
                  ? 'Checking this Mac…'
                  : 'This Mac is short on RAM for the on-device model — use your own API key instead.'}
              </p>
            )}
            <button type="button" className="wizard-link" onClick={() => setStep('done')}>
              {alreadyActive || notesState === 'done'
                ? 'Continue'
                : 'Skip — I’ll use my own API key (Settings → Notes model)'}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="wizard-body">
            <img src={mascotUrl} alt="" className="wizard-mascot" />
            <h1 className="wizard-title">You&rsquo;re all set</h1>
            <ul className="wizard-props">
              <li>
                Choose <strong>New → New meeting</strong> and DoodleNote records &amp; transcribes
                live
              </li>
              <li>Type rough notes during the call — <strong>Generate notes</strong> polishes them</li>
              <li>DoodleNote also offers to record when it notices you&rsquo;re on a call</li>
            </ul>
            <button type="button" className="wizard-cta" onClick={onFinish}>
              Start using DoodleNote
            </button>
          </div>
        )}

        {step !== 'done' && (
          <button type="button" className="wizard-skip" onClick={onFinish}>
            Skip setup
          </button>
        )}
      </div>
    </div>
  )
}
