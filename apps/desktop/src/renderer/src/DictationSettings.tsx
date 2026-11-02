import { useCallback, useEffect, useState } from 'react'
import type {
  DictationSettingsUpdate,
  DictationStatus,
  ShortcutState
} from '../../shared/dictation-api'
import {
  MOUSE_SOFTWARE_NOTE,
  PILL_EDGES,
  describeDoubleTap,
  describeFnKey,
  describeMouseButton,
  describeStopStages
} from '../../shared/dictation-pill'
import {
  accessibilityState,
  permissionAction,
  permissionButtonLabel,
  permissionLabel,
  relaunchHint,
  type PermissionOutcome,
  type PermissionPane,
  type PermissionState
} from '../../shared/dictation-permissions'
import { Toggle } from './ModelsView'

const HOLD_OPTIONS: Array<{ value: DictationStatus['settings']['holdKey']; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'rightOption', label: 'Right Option (⌥)' },
  { value: 'rightControl', label: 'Right Control (⌃)' },
  { value: 'rightCommand', label: 'Right Command (⌘)' },
  { value: 'fn', label: 'Fn / Globe' }
]

/** Translate a keydown into an Electron accelerator, or null if it is not a valid combo yet. */
function acceleratorFrom(event: React.KeyboardEvent): string | null {
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Command')
  const code = event.code
  let key: string | null = null
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code
  else if (code === 'Space') key = 'Space'
  if (!key || modifiers.length === 0) return null
  return [...modifiers, key].join('+')
}

function shortcutNote(state: ShortcutState): string {
  switch (state) {
    case 'registered':
      return 'Active.'
    case 'conflict':
      return 'Another app already uses this combination. Pick a different one.'
    case 'invalid':
      return 'That combination is not valid.'
    default:
      return 'Off.'
  }
}

const EDGE_LABELS: Record<(typeof PILL_EDGES)[number], string> = {
  bottom: 'Bottom of the screen',
  left: 'Left edge',
  right: 'Right edge'
}

function seconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`
}

export function DictationSettings(): React.JSX.Element {
  const [status, setStatus] = useState<DictationStatus | null>(null)
  const [recording, setRecording] = useState<'toggle' | 'pasteLast' | 'copyLast' | null>(null)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState<PermissionPane | null>(null)
  const [requested, setRequested] = useState<Partial<Record<PermissionPane, PermissionOutcome>>>({})
  const [capturing, setCapturing] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')

  const refresh = useCallback(() => {
    window.dictation
      .getStatus()
      .then(setStatus)
      .catch(() => setError('Could not read dictation status.'))
  }, [])

  useEffect(() => {
    refresh()
    const off = window.dictation.onStatus(setStatus)
    // Permission changes happen in System Settings, outside this window.
    window.addEventListener('focus', refresh)
    return () => {
      off()
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  const update = async (patch: DictationSettingsUpdate): Promise<void> => {
    setError('')
    try {
      setStatus(await window.dictation.setSettings(patch))
    } catch {
      setError('Could not save that change.')
    }
  }

  if (!status) {
    return (
      <section className="keys-section">
        <h3>Dictation</h3>
        <p className="models-sub">{error || 'Loading…'}</p>
      </section>
    )
  }
  if (!status.supported) {
    return (
      <section className="keys-section">
        <h3>Dictation</h3>
        <p className="models-sub">
          {status.channel === 'dev'
            ? 'System-wide dictation is available on macOS only for now.'
            : 'System-wide dictation is in development and is not part of this release.'}
        </p>
      </section>
    )
  }

  const { settings, permissions, cleanup } = status
  const askFor = async (pane: PermissionPane): Promise<void> => {
    setAsking(pane)
    try {
      const outcome = await window.dictation.requestPermission(pane)
      setRequested((previous) => ({ ...previous, [pane]: outcome }))
      // macOS will not prompt again: take the user to the switch.
      if (outcome === 'open-settings') void window.dictation.openPrivacySettings(pane)
      refresh()
    } catch {
      setError('Could not ask for that permission.')
    } finally {
      setAsking(null)
    }
  }
  const permissionRow = (
    pane: PermissionPane,
    title: string,
    why: string,
    state: PermissionState | null
  ): React.JSX.Element => {
    const action = permissionAction(pane, state)
    const label = permissionButtonLabel(action)
    const hint = relaunchHint(pane, requested[pane] ?? null)
    return (
      <div className="cal-row">
        <span className="cal-row-main">
          <span className="cal-row-label">{title}</span>
          <span className="cal-row-sub">
            {permissionLabel(state)} · {why}
          </span>
          {hint && state !== 'granted' && <span className="cal-row-sub">{hint}</span>}
        </span>
        {label && (
          <button
            type="button"
            className="pill-btn"
            disabled={asking === pane}
            onClick={() =>
              action === 'allow'
                ? void askFor(pane)
                : void window.dictation.openPrivacySettings(pane)
            }
          >
            {asking === pane ? 'Asking…' : label}
          </button>
        )}
        {state === 'granted' && (
          <button
            type="button"
            className="pill-btn"
            onClick={() => void window.dictation.openPrivacySettings(pane)}
          >
            Open System Settings
          </button>
        )}
      </div>
    )
  }
  const hiddenNow = status.pillHidden
  const captureMouse = async (): Promise<void> => {
    setCapturing(true)
    setCaptureMessage('')
    try {
      const result = await window.dictation.captureMouseButton()
      if (result.ok) await update({ holdMouseButton: result.button })
      else setCaptureMessage(result.message)
    } catch {
      setCaptureMessage('Could not read a mouse button. Try again.')
    } finally {
      setCapturing(false)
    }
  }
  const capture = (
    which: 'toggle' | 'pasteLast' | 'copyLast',
    event: React.KeyboardEvent
  ): void => {
    if (recording !== which) return
    event.preventDefault()
    if (event.key === 'Escape') return setRecording(null)
    const accelerator = acceleratorFrom(event)
    if (accelerator) {
      setRecording(null)
      void update(
        which === 'toggle'
          ? { toggleShortcut: accelerator }
          : which === 'pasteLast'
            ? { pasteLastShortcut: accelerator }
            : { copyLastShortcut: accelerator }
      )
    }
  }
  const byok = cleanup.byok
  const consented =
    byok !== null &&
    settings.byokConsent?.provider === byok.provider &&
    settings.byokConsent?.model === byok.model

  return (
    <>
      <section className="keys-section">
        <h3>Dictation</h3>
        <p className="models-sub">
          Press a shortcut in any app and speak. Speech is recognized on this Mac and the text is
          typed into the field you were using. Audio is never retained and never leaves this Mac.
        </p>
        {status.channel === 'dev' && (
          <p className="models-sub">
            <strong>Development build.</strong> It uses its own profile, library and permissions and
            never updates itself.
          </p>
        )}
        <div className="cal-subcard">
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Enable system-wide dictation</span>
              <span className="cal-row-sub">
                Off keeps the microphone, the shortcut and the insertion helper idle.
              </span>
            </span>
            <Toggle
              checked={settings.enabled}
              label="Enable system-wide dictation"
              onChange={() => void update({ enabled: !settings.enabled })}
            />
          </div>
        </div>
      </section>

      <section className="keys-section">
        <h3>Permissions</h3>
        <p className="models-sub">
          Allow asks macOS directly, which also lists DoodleNote Dev under Privacy &amp; Security.
          Once you have answered, macOS will not ask again and the button opens System Settings
          instead.
        </p>
        <div className="cal-subcard">
          {permissionRow(
            'microphone',
            'Microphone',
            'Needed to hear you.',
            permissions.microphone === 'unknown' ? 'unknown' : permissions.microphone
          )}
          {permissionRow(
            'accessibility',
            'Accessibility',
            'Needed to type into other apps. Without it your text is kept for copying.',
            accessibilityState(permissions.accessibility)
          )}
          {permissionRow(
            'input-monitoring',
            'Input Monitoring',
            'Only for hold-to-talk and the mouse button.',
            permissions.inputMonitoringAccess ?? accessibilityState(permissions.inputMonitoring)
          )}
        </div>
      </section>

      <section className="keys-section">
        <h3>Shortcuts</h3>
        {status.conflicts.length > 0 && (
          <p className="models-sub">
            {status.conflicts.join(', ')} is running. If both listen to the same keys, pick
            different shortcuts for each.
          </p>
        )}
        <div className="cal-subcard">
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Press to start, press again to stop</span>
              <span className="cal-row-sub">
                {settings.toggleShortcut || 'None'} · {shortcutNote(status.toggleShortcut)} Esc
                cancels while dictating.
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              onKeyDown={(event) => capture('toggle', event)}
              onBlur={() => setRecording(null)}
              onClick={() => setRecording('toggle')}
            >
              {recording === 'toggle' ? 'Press the new shortcut…' : 'Change'}
            </button>
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Hold to talk</span>
              <span className="cal-row-sub">
                Hold the key while speaking, release to insert.{' '}
                {status.holdKey === 'needs-permission'
                  ? 'Allow Input Monitoring first.'
                  : status.holdKey === 'active'
                    ? 'Active.'
                    : ''}
              </span>
              {settings.holdKey === 'fn' && (
                <span className="cal-row-sub">{describeFnKey(status.fnKeyAction)}</span>
              )}
            </span>
            <select
              aria-label="Hold-to-talk key"
              value={settings.holdKey}
              onChange={(event) =>
                void update({ holdKey: event.target.value as typeof settings.holdKey })
              }
            >
              {HOLD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Hold a mouse button to talk</span>
              <span className="cal-row-sub">
                {capturing
                  ? 'Press the mouse button you want to use now…'
                  : settings.holdMouseButton === null
                    ? 'None. Works in addition to the hold key; either one starts dictation.'
                    : `${describeMouseButton(settings.holdMouseButton)} · ${
                        status.mouseButton === 'active'
                          ? 'Active.'
                          : status.mouseButton === 'needs-permission'
                            ? 'Allow Input Monitoring first.'
                            : 'Not available right now.'
                      }`}
              </span>
              {captureMessage && <span className="cal-row-sub">{captureMessage}</span>}
              <span className="cal-row-sub">
                Middle, back, forward and extra buttons only; left and right click are never used.{' '}
                {MOUSE_SOFTWARE_NOTE}
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              disabled={capturing}
              onClick={() => void captureMouse()}
            >
              {capturing ? 'Waiting for a button…' : 'Press a mouse button…'}
            </button>
            {settings.holdMouseButton !== null && (
              <button
                type="button"
                className="pill-btn"
                onClick={() => {
                  setCaptureMessage('')
                  void update({ holdMouseButton: null })
                }}
              >
                Clear
              </button>
            )}
          </div>
          {settings.holdMouseButton !== null && (
            <div className="cal-row">
              <span className="cal-row-main">
                <span className="cal-row-label">Don&apos;t send this button to other apps</span>
                <span className="cal-row-sub">
                  {!settings.holdMouseSwallow
                    ? 'Off. The app under the pointer also sees the button (a back button will still go back).'
                    : status.mouseButton === 'active' && !status.mouseSwallowing
                      ? 'On, but macOS did not allow it, so the app under the pointer still sees the button. Allow Accessibility and Input Monitoring for this app and try again.'
                      : 'On. Only this button is held back; every other button works as usual.'}
                </span>
              </span>
              <Toggle
                checked={settings.holdMouseSwallow}
                label="Don't send the hold-to-talk mouse button to other apps"
                onChange={() => void update({ holdMouseSwallow: !settings.holdMouseSwallow })}
              />
            </div>
          )}
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Keep recording with a double tap</span>
              <span className="cal-row-sub">
                {describeDoubleTap(settings.handsFreeDoubleTap, settings.holdKey)}
              </span>
            </span>
            <Toggle
              checked={settings.handsFreeDoubleTap}
              label="Keep recording with a double tap of the hold key"
              onChange={() => void update({ handsFreeDoubleTap: !settings.handsFreeDoubleTap })}
            />
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Type the last transcript again</span>
              <span className="cal-row-sub">
                {settings.pasteLastShortcut || 'None'} · {shortcutNote(status.pasteLastShortcut)}{' '}
                The last transcript is kept in memory only and is forgotten when you quit.
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              onKeyDown={(event) => capture('pasteLast', event)}
              onBlur={() => setRecording(null)}
              onClick={() => setRecording('pasteLast')}
            >
              {recording === 'pasteLast' ? 'Press the new shortcut…' : 'Change'}
            </button>
            {settings.pasteLastShortcut && (
              <button
                type="button"
                className="pill-btn"
                onClick={() => void update({ pasteLastShortcut: '' })}
              >
                Turn off
              </button>
            )}
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Copy the last transcript</span>
              <span className="cal-row-sub">
                {settings.copyLastShortcut || 'None'} · {shortcutNote(status.copyLastShortcut)} Puts
                it on the clipboard instead of typing it. Same rule: memory only.
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              onKeyDown={(event) => capture('copyLast', event)}
              onBlur={() => setRecording(null)}
              onClick={() => setRecording('copyLast')}
            >
              {recording === 'copyLast' ? 'Press the new shortcut…' : 'Change'}
            </button>
            {settings.copyLastShortcut && (
              <button
                type="button"
                className="pill-btn"
                onClick={() => void update({ copyLastShortcut: '' })}
              >
                Turn off
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="keys-section">
        <h3>Pill and microphone</h3>
        <p className="models-sub">
          The pill is a small doodle at the edge of your screen. Click it to start dictating, click
          Finish to insert, right-click it for a menu, or drag it to another edge.
        </p>
        <div className="cal-subcard">
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Show the pill at all times</span>
              <span className="cal-row-sub">
                {hiddenNow
                  ? `Hidden until ${new Date(settings.pillHiddenUntil as number).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Starting dictation from the keyboard brings it back.`
                  : 'Off shows it only while you dictate.'}
              </span>
            </span>
            {hiddenNow && (
              <button
                type="button"
                className="pill-btn"
                onClick={() => void update({ pillHiddenUntil: null })}
              >
                Show it now
              </button>
            )}
            <Toggle
              checked={settings.showPill}
              label="Show the pill at all times"
              onChange={() => void update({ showPill: !settings.showPill })}
            />
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Pill position</span>
              <span className="cal-row-sub">
                It follows the screen your pointer is on. Dragging it also changes this.
              </span>
            </span>
            <select
              aria-label="Pill position"
              value={settings.pillEdge}
              onChange={(event) =>
                void update({ pillEdge: event.target.value as typeof settings.pillEdge })
              }
            >
              {PILL_EDGES.map((edge) => (
                <option key={edge} value={edge}>
                  {EDGE_LABELS[edge]}
                </option>
              ))}
            </select>
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Microphone</span>
              <span className="cal-row-sub">
                {status.microphoneMissing
                  ? 'The saved microphone is not connected, so the system default is used.'
                  : 'Used for dictation only. Meetings choose their own.'}
              </span>
            </span>
            <select
              aria-label="Dictation microphone"
              value={settings.microphoneUid ?? ''}
              onChange={(event) => void update({ microphoneUid: event.target.value || null })}
            >
              <option value="">System default</option>
              {settings.microphoneUid &&
                !status.microphones.some((mic) => mic.uid === settings.microphoneUid) && (
                  <option value={settings.microphoneUid}>Saved microphone (not connected)</option>
                )}
              {status.microphones.map((mic) => (
                <option key={mic.uid} value={mic.uid}>
                  {mic.name}
                </option>
              ))}
            </select>
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Show what I&apos;m saying</span>
              <span className="cal-row-sub">
                The words being recognised appear on the pill while you speak. Off keeps it to the
                squiggle.
              </span>
            </span>
            <Toggle
              checked={settings.showLiveText}
              label="Show the words being recognised on the pill"
              onChange={() => void update({ showLiveText: !settings.showLiveText })}
            />
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Show status messages</span>
              <span className="cal-row-sub">
                Captions such as Transcribing and Inserting, and the Inserted confirmation. Off
                leaves just the pill. Problems, kept text, a muted microphone and the one-minute
                warning always show.
              </span>
            </span>
            <Toggle
              checked={settings.showStatusMessages}
              label="Show status messages on the pill"
              onChange={() => void update({ showStatusMessages: !settings.showStatusMessages })}
            />
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Start and stop tones</span>
              <span className="cal-row-sub">
                A short two-note chime when recording begins and ends.
              </span>
            </span>
            <Toggle
              checked={settings.startSound}
              label="Play start and stop tones"
              onChange={() => void update({ startSound: !settings.startSound })}
            />
          </div>
        </div>
      </section>

      <section className="keys-section">
        <h3>Text cleanup</h3>
        <p className="models-sub">
          Recognition is always local. This only chooses what happens to the finished text. If
          cleanup is busy or fails, your raw words are inserted instead.
        </p>
        <div className="cal-subcard">
          <label className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Raw</span>
              <span className="cal-row-sub">Insert exactly what was recognized.</span>
            </span>
            <input
              type="radio"
              name="cleanup"
              checked={settings.cleanupMode === 'raw'}
              onChange={() => void update({ cleanupMode: 'raw' })}
            />
          </label>
          <label className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Local cleanup</span>
              <span className="cal-row-sub">
                {cleanup.localModelLabel
                  ? `Uses ${cleanup.localModelLabel} on this Mac.`
                  : 'Needs a notes model. Install one under Notes model.'}
              </span>
            </span>
            <input
              type="radio"
              name="cleanup"
              checked={settings.cleanupMode === 'local'}
              onChange={() => void update({ cleanupMode: 'local' })}
            />
          </label>
          <label className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Your provider</span>
              <span className="cal-row-sub">
                {byok
                  ? `${byok.provider}${byok.model ? ` · ${byok.model}` : ''}. Sends only the finished text, never audio.`
                  : 'Choose a provider and key under Notes model first.'}
              </span>
            </span>
            <input
              type="radio"
              name="cleanup"
              disabled={!byok}
              checked={settings.cleanupMode === 'byok'}
              onChange={() => void update({ cleanupMode: 'byok' })}
            />
          </label>
          {byok && (
            <div className="cal-row">
              <span className="cal-row-main">
                <span className="cal-row-label">
                  Allow sending dictated text to {byok.provider}
                </span>
                <span className="cal-row-sub">
                  Required before cleanup runs with your provider. Selecting a key alone never sends
                  anything. Changing provider or model asks again.
                </span>
              </span>
              <Toggle
                checked={consented}
                label="Allow sending dictated text to the provider"
                onChange={() =>
                  void update({
                    byokConsent: consented ? null : { provider: byok.provider, model: byok.model }
                  })
                }
              />
            </div>
          )}
        </div>
      </section>

      <section className="keys-section">
        <h3>Try it</h3>
        <p className="models-sub">
          Click in this box, then use your shortcut. This is a scratch field; nothing is saved.
        </p>
        <textarea
          aria-label="Dictation scratch field"
          rows={3}
          style={{ width: '100%' }}
          placeholder="Dictated text appears here"
        />
        <div className="cal-subcard">
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Speech model</span>
              <span className="cal-row-sub">
                {status.speech === 'warm'
                  ? 'Loaded. Dictation starts immediately.'
                  : 'Still loading. The first dictation may start slowly.'}
              </span>
            </span>
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Last dictation (measured on this Mac)</span>
              <span className="cal-row-sub">
                {status.lastLatency
                  ? `start ${seconds(status.lastLatency.startMs)} · stop→text ${seconds(status.lastLatency.stopToFinalMs)} · cleanup ${seconds(status.lastLatency.cleanupMs)} · insert ${seconds(status.lastLatency.insertMs)} · ${status.lastLatency.warm ? 'warm' : 'cold'}`
                  : 'No dictation yet.'}
              </span>
              {status.lastLatency && (
                <span className="cal-row-sub">{describeStopStages(status.lastLatency.stages)}</span>
              )}
            </span>
          </div>
        </div>
      </section>

      {status.recoveries.length > 0 && (
        <section className="keys-section">
          <h3>Kept text</h3>
          <p className="models-sub">
            Text that could not be inserted. It stays in memory until you dismiss it or quit.
          </p>
          <div className="cal-subcard">
            {status.recoveries.map((item) => (
              <div className="cal-row" key={item.gen}>
                <span className="cal-row-main">
                  <span className="cal-row-label">{item.text.slice(0, 160)}</span>
                  <span className="cal-row-sub">{item.reason.replace(/-/g, ' ')}</span>
                </span>
                <button
                  type="button"
                  className="pill-btn"
                  onClick={() => void window.dictation.copyRecovery(item.gen)}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  onClick={() => void window.dictation.dismissRecovery(item.gen)}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {error && <p className="models-sub">{error}</p>}
    </>
  )
}
