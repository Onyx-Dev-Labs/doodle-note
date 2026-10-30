import { useCallback, useEffect, useState } from 'react'
import type {
  DictationSettingsUpdate,
  DictationStatus,
  ShortcutState
} from '../../shared/dictation-api'
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

function permissionLabel(value: boolean | null): string {
  return value === null ? 'Checking…' : value ? 'Allowed' : 'Not allowed'
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

function seconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`
}

export function DictationSettings(): React.JSX.Element {
  const [status, setStatus] = useState<DictationStatus | null>(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')

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
        <div className="cal-subcard">
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Microphone</span>
              <span className="cal-row-sub">{permissions.microphone.replace('-', ' ')}</span>
            </span>
            <button
              type="button"
              className="pill-btn"
              onClick={() => void window.dictation.openPrivacySettings('microphone')}
            >
              Open System Settings
            </button>
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Accessibility</span>
              <span className="cal-row-sub">
                {permissionLabel(permissions.accessibility)} · needed to type into other apps.
                Without it your text is kept for copying.
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              onClick={() => void window.dictation.openPrivacySettings('accessibility')}
            >
              Open System Settings
            </button>
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Input Monitoring</span>
              <span className="cal-row-sub">
                {permissionLabel(permissions.inputMonitoring)} · only for hold-to-talk.
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              onClick={() => void window.dictation.openPrivacySettings('input-monitoring')}
            >
              Open System Settings
            </button>
          </div>
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
              onKeyDown={(event) => {
                if (!recording) return
                event.preventDefault()
                if (event.key === 'Escape') return setRecording(false)
                const accelerator = acceleratorFrom(event)
                if (accelerator) {
                  setRecording(false)
                  void update({ toggleShortcut: accelerator })
                }
              }}
              onBlur={() => setRecording(false)}
              onClick={() => setRecording(true)}
            >
              {recording ? 'Press the new shortcut…' : 'Change'}
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
