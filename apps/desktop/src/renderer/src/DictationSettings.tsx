import { SettingsFold } from './SettingsFold'
import { BarkMark } from './BarkMark'
import { useCallback, useEffect, useState } from 'react'
import type {
  DictationSettingsUpdate,
  DictationStatus,
  ShortcutState
} from '../../shared/dictation-api'
import {
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
import { acceleratorFrom } from './dictation-accelerator'
import {
  DictationStyleSettings,
  DictationTidySettings,
  DictationTransformSettings
} from './DictationTidySettings'
import { DictationDictionarySettings } from './DictationDictionarySettings'
import { FEATURE_NAME } from '../../shared/dictation-brand'
import {
  HOLD_KEY_OPTIONS,
  barkCopy,
  barkPlatform,
  describeWindowsHelper,
  describeWindowsHooks
} from '../../shared/dictation-platform'
import { hostPlatform } from './lib/platform'
import { Toggle } from './ModelsView'

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
  const platform = barkPlatform(hostPlatform())
  const copy = barkCopy(platform)
  const windows = platform === 'win32'
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
        <p className="models-sub">{copy.unsupported}</p>
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
    // Windows never prompts for the microphone: the switch is in Windows Settings.
    const action =
      windows && state !== null && state !== 'granted'
        ? 'open-settings'
        : permissionAction(pane, state)
    const label =
      windows && action === 'open-settings'
        ? `Open ${copy.settingsApp}`
        : permissionButtonLabel(action)
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
            {`Open ${copy.settingsApp}`}
          </button>
        )}
      </div>
    )
  }
  /** Windows: a row that only reports (Windows asks no permission for these). */
  const infoRow = (title: string, label: string, detail: string): React.JSX.Element => (
    <div className="cal-row">
      <span className="cal-row-main">
        <span className="cal-row-label">{title}</span>
        <span className="cal-row-sub">
          {label} · {detail}
        </span>
      </span>
    </div>
  )
  const microphoneState = permissions.microphone === 'unknown' ? 'unknown' : permissions.microphone
  const hooks = describeWindowsHooks(permissions.inputMonitoring, permissions.hooksLive)
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

  return (
    <>
      <section className="keys-section">
        <h3 className="bark-heading">
          <BarkMark size={44} />
          {FEATURE_NAME}
        </h3>
        <p className="models-sub">{copy.intro}</p>
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

      <SettingsFold title="Permissions" description={copy.permissionsDescription}>
        <p className="models-sub">{copy.permissionsIntro}</p>
        {windows ? (
          <div className="cal-subcard">
            {permissionRow('microphone', 'Microphone', 'Needed to hear you.', microphoneState)}
            {infoRow(
              'Typing into other apps',
              'No permission needed',
              'The text goes in through the clipboard and Ctrl+V, and your clipboard is put back afterwards. Apps running as administrator cannot be typed into.'
            )}
            {infoRow(
              `${FEATURE_NAME} helper`,
              status.helper === 'ready'
                ? 'Ready'
                : status.helper === 'blocked'
                  ? 'Blocked by Windows'
                  : status.helper === 'damaged'
                    ? 'Damaged'
                    : 'Missing',
              describeWindowsHelper(status.helper)
            )}
            {infoRow('Keyboard and mouse hook', hooks.label, hooks.detail)}
          </div>
        ) : (
          <div className="cal-subcard">
            {permissionRow('microphone', 'Microphone', 'Needed to hear you.', microphoneState)}
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
        )}
      </SettingsFold>

      <SettingsFold title="Shortcuts" description="Keyboard, mouse, and hands-free controls">
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
                  ? copy.holdNeedsPermission
                  : status.holdKey === 'active'
                    ? 'Active.'
                    : ''}
              </span>
              {settings.holdKey === 'fn' && (
                <span className="cal-row-sub">{describeFnKey(status.fnKeyAction)}</span>
              )}
              {windows && settings.holdKey === 'rightOption' && (
                <span className="cal-row-sub">
                  On a layout with AltGr, holding Right Alt types nothing on its own, but adding a
                  letter key produces that layout&apos;s AltGr character instead of dictating.
                </span>
              )}
            </span>
            <select
              aria-label="Hold-to-talk key"
              value={settings.holdKey}
              onChange={(event) =>
                void update({ holdKey: event.target.value as typeof settings.holdKey })
              }
            >
              {HOLD_KEY_OPTIONS[platform].map((option) => (
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
                            ? copy.mouseNeedsPermission
                            : 'Not available right now.'
                      }`}
              </span>
              {captureMessage && <span className="cal-row-sub">{captureMessage}</span>}
              <span className="cal-row-sub">
                {copy.mouseButtonsNote} {copy.mouseSoftwareNote}
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
                      ? copy.swallowRefused
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
      </SettingsFold>

      <SettingsFold
        title="Pill and microphone"
        description="Position, input, live words, and audio feedback"
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
                  ? `Loaded. Dictation starts immediately${windows ? `, and stays loaded while ${FEATURE_NAME} is on` : ''}.`
                  : 'Still loading. The first dictation may start slowly.'}
              </span>
            </span>
          </div>
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">{copy.latencyLabel}</span>
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
