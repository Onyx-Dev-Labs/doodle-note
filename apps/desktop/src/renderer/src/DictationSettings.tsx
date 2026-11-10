import { SettingsFold } from './SettingsFold'
import { BarkMark } from './BarkMark'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  describeMouseMode,
  MOUSE_MODE_LABELS,
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
import { shortcutLabel, shortcutWarning } from './dictation-accelerator'
import {
  canSaveShortcutCapture,
  captureShortcutKey,
  emptyShortcutCapture
} from './dictation-shortcut-capture'
import './assets/shortcut-recorder.css'
import {
  DictationStyleSettings,
  DictationTidySettings,
  DictationTransformSettings
} from './DictationTidySettings'
import { DictationDictionarySettings } from './DictationDictionarySettings'
import { DictationVoiceSettings } from './DictationVoiceSettings'
import { FEATURE_NAME } from '../../shared/dictation-brand'
import { Toggle } from './ModelsView'

const HOLD_OPTIONS: Array<{ value: DictationStatus['settings']['holdKey']; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'rightOption', label: 'Right Option (⌥)' },
  { value: 'rightControl', label: 'Right Control (⌃)' },
  { value: 'rightCommand', label: 'Right Command (⌘)' },
  { value: 'fn', label: 'Fn / Globe' }
]

function shortcutNote(state: ShortcutState): string {
  switch (state) {
    case 'registered':
      return 'Active.'
    case 'needs-permission':
      return 'Allow Input Monitoring in Permissions to use this shortcut.'
    case 'conflict':
    case 'invalid':
      return 'This shortcut isn’t available. Try another.'
    default:
      return 'Off.'
  }
}

type RecordedAction = 'toggle' | 'pasteLast' | 'copyLast'

function ShortcutRecorder({
  action,
  onSave,
  onCancel
}: {
  action: RecordedAction
  onSave: (candidate: string) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [capture, setCapture] = useState(emptyShortcutCapture)
  const [armed, setArmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const input = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const cancel = useRef(onCancel)
  useEffect(() => {
    cancel.current = onCancel
  }, [onCancel])
  useEffect(() => {
    alive.current = true
    let current = true
    const blur = (): void => cancel.current()
    window.addEventListener('blur', blur)
    void window.dictation.setShortcutRecording(true).then(
      () => {
        if (!current) return
        setArmed(true)
        input.current?.focus()
      },
      () => {
        if (current) setFailure('Could not pause dictation shortcuts. Cancel and try again.')
      }
    )
    return () => {
      current = false
      alive.current = false
      window.removeEventListener('blur', blur)
      void window.dictation.setShortcutRecording(false).catch(() => {})
    }
  }, [])

  const listen = (): void => {
    setCapture(emptyShortcutCapture())
    setFailure('')
    input.current?.focus()
  }
  const key = (event: React.KeyboardEvent, direction: 'down' | 'up'): void => {
    if (!armed || saving || capture.phase === 'ready' || capture.phase === 'error') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      onCancel()
      return
    }
    setCapture((current) => captureShortcutKey(current, event, direction, action === 'toggle'))
  }
  const save = async (event: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    if (!armed || saving || !capture.candidate || !canSaveShortcutCapture(capture)) return
    if (!canSaveShortcutCapture(capture, event)) {
      setFailure('Release the shortcut keys, then choose Save.')
      return
    }
    // Keep focus inside the recorder before disabling the clicked Save button.
    // Otherwise Chromium blurs it and cancels the editor before a rejection arrives.
    input.current?.focus()
    setSaving(true)
    setFailure('')
    try {
      await onSave(capture.candidate)
      if (alive.current) onCancel()
    } catch (error) {
      if (alive.current)
        setFailure(
          error instanceof Error ? error.message : 'This shortcut isn’t available. Try another.'
        )
    } finally {
      if (alive.current) setSaving(false)
    }
  }
  const warning = capture.candidate ? shortcutWarning(capture.candidate) : null
  return (
    <div
      className="shortcut-recorder"
      role="group"
      aria-label="Record keyboard shortcut"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onCancel()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <p className="models-sub">
        Press and release your shortcut, then choose Save. Escape cancels and cannot be a shortcut.
      </p>
      <div
        ref={input}
        className="shortcut-recorder-input"
        tabIndex={0}
        role="group"
        aria-label="Press shortcut keys"
        onKeyDown={(event) => key(event, 'down')}
        onKeyUp={(event) => key(event, 'up')}
      >
        {!armed
          ? 'Preparing…'
          : capture.phase === 'pressed'
            ? capture.candidate && !capture.error
              ? `${shortcutLabel(capture.candidate)} — release keys, then Save`
              : 'Release all keys…'
            : capture.candidate
              ? shortcutLabel(capture.candidate)
              : capture.phase === 'error'
                ? 'Try another shortcut'
                : 'Press a key or combination…'}
      </div>
      <div role="status" aria-live="polite">
        {capture.error && <p className="models-sub">{capture.error}</p>}
        {capture.candidate && (
          <p className="models-sub">New shortcut: {shortcutLabel(capture.candidate)}</p>
        )}
        {warning && <p className="models-sub">{warning}</p>}
        {capture.candidate?.startsWith('Modifier:') && (
          <p className="models-sub">A standalone modifier needs Input Monitoring permission.</p>
        )}
      </div>
      {failure && (
        <p className="models-error" role="alert">
          {failure}
        </p>
      )}
      <div className="shortcut-recorder-actions">
        {action === 'toggle' && (
          <button
            type="button"
            className="pill-btn"
            disabled={!armed || saving}
            onClick={() => {
              setFailure('')
              setCapture({
                ...emptyShortcutCapture(),
                phase: 'ready',
                candidate: 'Modifier:AltRight'
              })
            }}
          >
            Use Right Option (⌥)
          </button>
        )}
        <button type="button" className="pill-btn" disabled={!armed || saving} onClick={listen}>
          Record again
        </button>
        <button
          type="button"
          className="pill-btn"
          disabled={!armed || saving || !canSaveShortcutCapture(capture)}
          onClick={(event) => void save(event)}
        >
          {saving ? 'Saving…' : 'Save shortcut'}
        </button>
        <button type="button" className="pill-btn" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
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
        <h3 className="bark-heading">
          <BarkMark size={44} />
          {FEATURE_NAME}
        </h3>
        <p className="models-sub">{error || 'Loading…'}</p>
      </section>
    )
  }
  if (!status.supported) {
    return (
      <section className="keys-section">
        <h3 className="bark-heading">
          <BarkMark size={44} />
          {FEATURE_NAME}
        </h3>
        <p className="models-sub">
          {`${FEATURE_NAME}, DoodleNote's dictation, is available on macOS only for now.`}
        </p>
      </section>
    )
  }

  const { settings, permissions } = status
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
  const shortcutBusy = !['idle', 'notice', 'recovery'].includes(status.phase)
  const saveShortcut = async (which: RecordedAction, candidate: string): Promise<void> => {
    let next: DictationStatus
    try {
      next = await window.dictation.setSettings(
        which === 'toggle'
          ? { toggleShortcut: candidate }
          : which === 'pasteLast'
            ? { pasteLastShortcut: candidate }
            : { copyLastShortcut: candidate }
      )
    } catch {
      throw new Error('This shortcut isn’t available. Try another.')
    }
    setStatus(next)
    const state =
      which === 'toggle'
        ? next.toggleShortcut
        : which === 'pasteLast'
          ? next.pasteLastShortcut
          : next.copyLastShortcut
    const issue =
      next.shortcutIssues?.[
        which === 'toggle' ? 'toggle' : which === 'pasteLast' ? 'paste' : 'copy'
      ]
    const saved =
      which === 'toggle'
        ? next.settings.toggleShortcut
        : which === 'pasteLast'
          ? next.settings.pasteLastShortcut
          : next.settings.copyLastShortcut
    if (saved !== candidate || issue || state === 'conflict' || state === 'invalid')
      throw new Error(issue || 'This shortcut isn’t available. Try another.')
  }
  const recorder = (which: RecordedAction): React.JSX.Element | null =>
    recording === which ? (
      <ShortcutRecorder
        key={which}
        action={which}
        onSave={(candidate) => saveShortcut(which, candidate)}
        onCancel={() => setRecording(null)}
      />
    ) : null

  return (
    <>
      <section className="keys-section">
        <h3 className="bark-heading">
          <BarkMark size={44} />
          {FEATURE_NAME}
        </h3>
        <p className="models-sub">
          {FEATURE_NAME} is DoodleNote&apos;s dictation. Press a shortcut in any app and speak.
          Speech is recognized on this Mac and the text is typed into the field you were using.
          Audio is never retained and never leaves this Mac.
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
              <span className="cal-row-label">Turn on {FEATURE_NAME}</span>
              <span className="cal-row-sub">
                Off keeps the microphone, the shortcut and the insertion helper idle.
              </span>
            </span>
            <Toggle
              checked={settings.enabled}
              label={`Turn on ${FEATURE_NAME}`}
              onChange={() => void update({ enabled: !settings.enabled })}
            />
          </div>
        </div>
      </section>

      <SettingsFold
        title="Permissions"
        description="Microphone, Accessibility, and Input Monitoring"
      >
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
            'Needed for standalone modifier shortcuts, hold-to-talk, and mouse buttons.',
            permissions.inputMonitoringAccess ?? accessibilityState(permissions.inputMonitoring)
          )}
        </div>
      </SettingsFold>

      <SettingsFold title="Shortcuts" description="Keyboard, mouse, and hands-free controls">
        {status.conflicts.length > 0 && (
          <p className="models-sub">
            {status.conflicts.join(', ')} is running. If both listen to the same keys, pick
            different shortcuts for each.
          </p>
        )}
        {shortcutBusy && (
          <p className="models-sub">Finish dictating before changing your shortcut.</p>
        )}
        <div className="cal-subcard">
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Bark keyboard shortcut</span>
              <span className="cal-row-sub">
                {shortcutLabel(settings.toggleShortcut)} ·{' '}
                {status.shortcutIssues?.toggle || shortcutNote(status.toggleShortcut)} Press once to
                start and again to stop. Escape cancels dictation.
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              disabled={shortcutBusy || recording !== null}
              title={shortcutBusy ? 'Finish dictating before changing your shortcut.' : undefined}
              onClick={() => setRecording('toggle')}
            >
              Change shortcut
            </button>
          </div>
          {recorder('toggle')}
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
              <span className="cal-row-label">Mouse button</span>
              <span className="cal-row-sub">
                {capturing
                  ? 'Press the mouse button you want to use now…'
                  : settings.holdMouseButton === null
                    ? 'None. A mouse button works in addition to the hold key; either one starts dictation.'
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
                <span className="cal-row-label">Mouse button behaviour</span>
                <span className="cal-row-sub">{describeMouseMode(settings.holdMouseMode)}</span>
              </span>
              <select
                aria-label="Mouse button behaviour"
                value={settings.holdMouseMode}
                onChange={(event) =>
                  void update({
                    holdMouseMode: event.target.value as typeof settings.holdMouseMode
                  })
                }
              >
                <option value="click">{MOUSE_MODE_LABELS.click}</option>
                <option value="hold">{MOUSE_MODE_LABELS.hold}</option>
              </select>
            </div>
          )}
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
                label="Don't send the dictation mouse button to other apps"
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
                {shortcutLabel(settings.pasteLastShortcut)} ·{' '}
                {status.shortcutIssues?.paste || shortcutNote(status.pasteLastShortcut)} The last
                transcript is kept in memory only and is forgotten when you quit.
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              disabled={shortcutBusy || recording !== null}
              title={shortcutBusy ? 'Finish dictating before changing your shortcut.' : undefined}
              onClick={() => setRecording('pasteLast')}
            >
              Change shortcut
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
          {recorder('pasteLast')}
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Copy the last transcript</span>
              <span className="cal-row-sub">
                {shortcutLabel(settings.copyLastShortcut)} ·{' '}
                {status.shortcutIssues?.copy || shortcutNote(status.copyLastShortcut)} Puts it on
                the clipboard instead of typing it. Same rule: memory only.
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              disabled={shortcutBusy || recording !== null}
              title={shortcutBusy ? 'Finish dictating before changing your shortcut.' : undefined}
              onClick={() => setRecording('copyLast')}
            >
              Change shortcut
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
          {recorder('copyLast')}
        </div>
      </SettingsFold>

      <SettingsFold
        title="Pill and microphone"
        description="Position, input, your voice, live words, and audio feedback"
      >
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
          <DictationVoiceSettings status={status} update={update} />
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
              <span className="cal-row-label">Show where the text will go</span>
              <span className="cal-row-sub">
                The icon of the app you are dictating into (Chrome, Slack, your editor) sits on the
                pill while you speak, so you can see where the words will land. Only the app&apos;s
                icon is read; nothing about what is in it.
              </span>
            </span>
            <Toggle
              checked={settings.showTargetApp}
              label="Show the icon of the app the text will be typed into"
              onChange={() => void update({ showTargetApp: !settings.showTargetApp })}
            />
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Mute other audio while dictating</span>
              <span className="cal-row-sub">
                Music, radio or a video is silenced while you record and comes straight back when
                you finish, so it does not leak into your voice. If your sound was already muted, or
                you change the volume yourself meanwhile, it is left as you set it.
              </span>
            </span>
            <Toggle
              checked={settings.muteAudioWhileDictating}
              label="Mute other audio while dictating"
              onChange={() =>
                void update({ muteAudioWhileDictating: !settings.muteAudioWhileDictating })
              }
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
      </SettingsFold>

      <DictationTidySettings status={status} update={update} />
      <DictationStyleSettings status={status} update={update} />
      <DictationDictionarySettings status={status} update={update} />
      <DictationTransformSettings status={status} update={update} />

      <SettingsFold title="Try it" description="Dictation scratch field and model diagnostics">
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
      </SettingsFold>

      {status.recoveries.length > 0 && (
        <SettingsFold
          title="Kept text"
          description="Text that could not be inserted"
          attention={status.recoveries.map((item) => item.gen).join(',')}
        >
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
        </SettingsFold>
      )}
      {error && <p className="models-sub">{error}</p>}
    </>
  )
}
