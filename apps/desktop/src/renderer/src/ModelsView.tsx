import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarPrefsUpdate, CalendarState } from '../../shared/calendar-api'
import type { DetectState } from '../../shared/detect-api'
import type { SyncStatus } from '../../shared/sync-api'
import type { UpdateState } from '../../shared/update-api'
import { CalendarIcon, CloudIcon, GearIcon, SparkleIcon } from './icons'
import { getThemePref, setThemePref, type ThemePref } from './theme'
import type {
  CloudProvider,
  EngineChoice,
  NotesModelInfo,
  NotesModelsResponse,
  NotesSettingsView
} from '../../shared/notes-api'
import mascotUrl from './assets/mascot-square.png'

function lastSyncLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 60_000) return 'synced just now'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `synced ${min} min ago`
  return `synced at ${new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

/**
 * Settings: one card per catalog model with download/activate states,
 * plus the optional BYOK cloud section. Same IPC as before — only the
 * presentation moved to the light DoodleNote theme.
 */
function GoogleLogo(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

function MicrosoftLogo(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

/** A macOS-style menu bar (screen with the top strip highlighted). */
function MenuBarIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" />
      <circle cx="12" cy="4" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  )
}

function PeopleIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="5.6" cy="5.4" r="2.2" />
      <path d="M1.6 13.4c0-2.2 1.8-4 4-4s4 1.8 4 4" />
      <circle cx="11.6" cy="6" r="1.8" />
      <path d="M11.2 9.5c1.9.3 3.3 1.9 3.3 3.9" />
    </svg>
  )
}

/** Light-theme switch (sage when on), used by the calendar display prefs. */
function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  title
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  /** Accessible name — the visible label lives in the surrounding row. */
  label: string
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? 'toggle on' : 'toggle'}
      disabled={disabled}
      {...(title !== undefined ? { title } : {})}
      onClick={onChange}
    >
      <span className="toggle-knob" aria-hidden="true" />
    </button>
  )
}

type SettingsSection = 'general' | 'calendar' | 'sync' | 'model'

const SETTINGS_NAV: Array<{ key: SettingsSection; icon: React.JSX.Element; label: string }> = [
  { key: 'general', icon: <GearIcon size={15} />, label: 'General' },
  { key: 'calendar', icon: <CalendarIcon size={15} />, label: 'Calendar' },
  { key: 'sync', icon: <CloudIcon size={15} />, label: 'Cloud sync' },
  { key: 'model', icon: <SparkleIcon size={15} />, label: 'Notes model' }
]

export default function ModelsView({ active }: { active: boolean }): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>('general')
  const [data, setData] = useState<NotesModelsResponse | null>(null)
  const [settings, setSettings] = useState<NotesSettingsView | null>(null)
  const [downloading, setDownloading] = useState<{ id: string; progress: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [provider, setProvider] = useState<CloudProvider>('anthropic')
  const [cloudModel, setCloudModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const cloudFormSeeded = useRef(false)

  /* ---- cloud sync ---- */
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [linkPending, setLinkPending] = useState(false)

  /* ---- meeting detection ---- */
  const [detect, setDetect] = useState<DetectState | null>(null)

  /* ---- appearance ---- */
  const [theme, setTheme] = useState<ThemePref>(() => getThemePref())

  /* ---- updates ---- */
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [checkPending, setCheckPending] = useState(false)

  useEffect(() => {
    if (active) {
      void window.updates
        .getState()
        .then(setUpdate)
        .catch(() => setUpdate(null))
    }
  }, [active])

  useEffect(() => window.updates.onState(setUpdate), [])

  const checkForUpdates = async (): Promise<void> => {
    if (checkPending) return
    setCheckPending(true)
    try {
      setUpdate(await window.updates.check())
    } finally {
      setCheckPending(false)
    }
  }

  const updateStatusLine = (u: UpdateState): string => {
    if (!u.supported) return 'Updates apply to the installed app (not dev builds)'
    switch (u.status) {
      case 'checking':
        return 'Checking…'
      case 'downloading':
        return `Downloading v${u.latestVersion ?? ''}… ${u.percent ?? 0}%`
      case 'downloaded':
        return `v${u.latestVersion} is ready to install`
      case 'up-to-date':
        return 'You are on the latest version'
      case 'error':
        return u.error ?? 'Update check failed'
      default:
        return 'Checks automatically on launch and every 6 hours'
    }
  }

  /* ---- calendar (Microsoft 365) ---- */
  const [calState, setCalState] = useState<CalendarState | null>(null)
  const [clientId, setClientId] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [editingCalConfig, setEditingCalConfig] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const calFormSeeded = useRef(false)

  const adoptCalState = useCallback((state: CalendarState) => {
    setCalState(state)
    // Seed the config inputs once from what's saved on disk.
    if (!calFormSeeded.current && state.configured) {
      calFormSeeded.current = true
      setClientId(state.clientId ?? '')
      setTenantId(state.tenantId ?? '')
    }
  }, [])

  const refreshCalendar = useCallback(() => {
    void window.calendar
      .getState()
      .then(adoptCalState)
      .catch(() => setCalState(null))
  }, [adoptCalState])

  useEffect(() => {
    if (active) refreshCalendar()
  }, [active, refreshCalendar])

  useEffect(() => window.calendar.onEvents(adoptCalState), [adoptCalState])

  useEffect(() => {
    if (active) {
      void window.sync
        .getStatus()
        .then(setSyncStatus)
        .catch(() => setSyncStatus(null))
    }
  }, [active])

  useEffect(() => window.sync.onStatus(setSyncStatus), [])

  useEffect(() => {
    if (active) {
      void window.detect
        .getState()
        .then(setDetect)
        .catch(() => setDetect(null))
    }
  }, [active])

  const connectSync = async (): Promise<void> => {
    if (linkPending) return
    setLinkPending(true)
    try {
      setSyncStatus(await window.sync.connect())
    } finally {
      setLinkPending(false)
    }
  }

  const saveCalendarConfig = async (): Promise<void> => {
    const state = await window.calendar.setConfig({
      clientId: clientId.trim(),
      tenantId: tenantId.trim()
    })
    setCalState(state)
    if (state.configured && !state.error) setEditingCalConfig(false)
  }

  const connectCalendar = async (): Promise<void> => {
    if (connecting) return
    setConnecting(true)
    try {
      setCalState(await window.calendar.connect())
    } finally {
      setConnecting(false)
    }
  }

  const [googleConnecting, setGoogleConnecting] = useState(false)

  const connectGoogle = async (): Promise<void> => {
    if (googleConnecting) return
    setGoogleConnecting(true)
    try {
      setCalState(await window.calendar.connectGoogle())
    } finally {
      setGoogleConnecting(false)
    }
  }

  const syncCalendar = async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    try {
      setCalState(await window.calendar.refresh())
    } finally {
      setSyncing(false)
    }
  }

  const disconnectCalendar = async (): Promise<void> => {
    setCalState(await window.calendar.disconnect())
  }

  /** Partial display-prefs update; main persists and echoes the new state. */
  const setCalPrefs = (update: CalendarPrefsUpdate): void => {
    void window.calendar
      .setPrefs(update)
      .then(adoptCalState)
      .catch(() => {})
  }

  /**
   * The effective visible set for the toggles: the saved list, or — while
   * visibleCalendarIds is null — the default calendar (first one as a last
   * resort, mirroring the service).
   */
  const visibleCalendarIds = (state: CalendarState): Set<string> => {
    if (state.prefs.visibleCalendarIds !== null) return new Set(state.prefs.visibleCalendarIds)
    const defaults = state.calendars.filter((c) => c.isDefault).map((c) => c.id)
    if (defaults.length === 0 && state.calendars.length > 0) {
      const first = state.calendars[0]
      if (first) return new Set([first.id])
    }
    return new Set(defaults)
  }

  /** Flip one calendar row, keeping at least one calendar visible. */
  const toggleCalendar = (state: CalendarState, id: string): void => {
    const next = visibleCalendarIds(state)
    if (next.has(id)) {
      if (next.size === 1) return // min one visible
      next.delete(id)
    } else {
      next.add(id)
    }
    setCalPrefs({ visibleCalendarIds: [...next] })
  }

  const refresh = useCallback(() => {
    void window.notes
      .models()
      .then(setData)
      .catch(() => setData(null))
    void window.notes
      .getSettings()
      .then((view) => {
        setSettings(view)
        // Seed the cloud form once from saved settings.
        if (!cloudFormSeeded.current && view.cloud) {
          cloudFormSeeded.current = true
          setProvider(view.cloud.provider)
          setCloudModel(view.cloud.model ?? '')
        }
      })
      .catch(() => setSettings(null))
  }, [])

  useEffect(() => {
    if (active) refresh()
  }, [active, refresh])

  useEffect(
    () =>
      window.notes.onDownloadProgress((ev) => {
        setDownloading((d) => (d && d.id === ev.modelId ? { ...d, progress: ev.progress } : d))
      }),
    []
  )

  const activate = async (modelId: string): Promise<void> => {
    setError(null)
    setDownloading({ id: modelId, progress: 0 })
    const result = await window.notes.activateModel(modelId)
    setDownloading(null)
    if (!result.ok) setError(result.error ?? 'activation failed')
    refresh()
  }

  const chooseEngine = async (choice: EngineChoice): Promise<void> => {
    setError(null)
    const view = await window.notes.setSettings({ engineChoice: choice })
    setSettings(view)
  }

  const saveCloudKey = async (): Promise<void> => {
    setError(null)
    const view = await window.notes.setSettings({
      cloud: {
        provider,
        ...(cloudModel.trim() ? { model: cloudModel.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
      }
    })
    setSettings(view)
    setApiKey('')
    if (view.error) {
      setError(view.error)
    } else if (view.cloud?.hasKey) {
      setKeySaved(true)
      setTimeout(() => setKeySaved(false), 2000)
    }
  }

  const renderAction = (m: NotesModelInfo): React.JSX.Element => {
    if (downloading?.id === m.id) {
      const pct = Math.round(downloading.progress * 100)
      return (
        <div className="model-progress">
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-label">
            {downloading.progress > 0 ? `downloading… ${pct}%` : 'preparing…'}
          </span>
        </div>
      )
    }
    if (m.active) {
      return <span className="badge badge-active">Active</span>
    }
    if (!m.available) {
      return <span className="model-note">needs {m.minRamGB} GB RAM</span>
    }
    return (
      <button type="button" disabled={downloading !== null} onClick={() => void activate(m.id)}>
        {m.downloaded ? 'Activate' : 'Download & activate'}
      </button>
    )
  }

  const engineChoice: EngineChoice = settings?.engineChoice ?? 'local'

  return (
    <div className="models">
      <header className="models-header">
        <img className="settings-mascot" src={mascotUrl} alt="" />
        <div>
          <h2>Settings</h2>
          <p className="models-sub">
            Local-first by default — nothing leaves this Mac unless you turn it on.
          </p>
        </div>
      </header>

      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={section === item.key ? 'settings-nav-btn on' : 'settings-nav-btn'}
              onClick={() => setSection(item.key)}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
          {detect !== null && (
            <button
              type="button"
              className="settings-version"
              title="See what changed in each version"
              onClick={() => window.open('https://doodle-note.vercel.app/changelog')}
            >
              v{detect.appVersion} · What&rsquo;s new
            </button>
          )}
        </nav>

        <div className="settings-content">
          {section === 'model' && (
            <section className="keys-section">
              <h3>On-device model</h3>
              <p className="models-sub">
                DoodleNote polishes your meeting notes with a model that runs entirely on this Mac
                {data ? ` (${data.ramGB} GB RAM)` : ''}. Download one once — nothing leaves your
                machine.
              </p>

              {error && <div className="models-error">{error}</div>}

              <div className="model-cards">
        {data === null && <span className="placeholder">loading models…</span>}
        {data?.models.map((m) => (
          <div
            key={m.id}
            className={`model-card${m.available ? '' : ' unavailable'}${m.active ? ' is-active' : ''}`}
          >
            <div className="model-head">
              <span className="model-label">{m.label}</span>
              {m.downloaded && !m.active && <span className="badge">Downloaded</span>}
            </div>
            <div className="model-desc">{m.description}</div>
            <div className="model-meta">
              {m.sizeGB.toFixed(1)} GB download · needs {m.minRamGB} GB RAM
            </div>
            <div className="model-action">{renderAction(m)}</div>
          </div>
        ))}
      </div>
            </section>
          )}

          {section === 'calendar' && (
      <section className="keys-section calendar-section">
        <h3>Calendar</h3>
        <p className="models-sub">
          Sign in with any Microsoft account — work, school, or personal — to see the week&rsquo;s
          meetings on Home and get a nudge to take notes the moment one starts. DoodleNote only
          reads your calendar.
        </p>

        {calState?.error && <div className="models-error">{calState.error}</div>}

        {calState === null ? (
          <span className="calendar-note">loading calendar settings…</span>
        ) : (!calState.configured && !calState.builtIn) || editingCalConfig ? (
          <>
            <div className="key-form">
              <input
                type="text"
                spellCheck={false}
                placeholder="Client ID"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
              <input
                type="text"
                spellCheck={false}
                placeholder="Tenant ID"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              />
              <button type="button" onClick={() => void saveCalendarConfig()}>
                Save
              </button>
              {editingCalConfig && (
                <button type="button" onClick={() => setEditingCalConfig(false)}>
                  Cancel
                </button>
              )}
            </div>
            <p className="calendar-help">
              Entra admin center → App registrations → DoodleNote — paste the Application (client)
              ID and Directory (tenant) ID from there.
            </p>
          </>
        ) : !calState.signedIn ? (
          <div className="calendar-actions">
            <button
              type="button"
              className="ms-signin"
              disabled={connecting}
              onClick={() => void connectCalendar()}
            >
              <MicrosoftLogo />
              <span>{connecting ? 'Waiting for your browser…' : 'Sign in with Microsoft'}</span>
            </button>
            <button
              type="button"
              className="ms-signin"
              disabled={googleConnecting}
              onClick={() => void connectGoogle()}
            >
              <GoogleLogo />
              <span>{googleConnecting ? 'Waiting for your browser…' : 'Sign in with Google'}</span>
            </button>
            {!calState.builtIn && (
              <button
                type="button"
                className="calendar-ghost"
                onClick={() => setEditingCalConfig(true)}
              >
                Edit IDs
              </button>
            )}
            {connecting && (
              <span className="calendar-note">
                finish signing in in your browser, then come back
              </span>
            )}
          </div>
        ) : (
          <div className="calendar-connected">
            <span className="calendar-status">
              {calState.msSignedIn && (
                <>
                  Microsoft:{' '}
                  <strong>{calState.account?.email ?? 'connected'}</strong>
                </>
              )}
              {calState.msSignedIn && calState.googleSignedIn && ' · '}
              {calState.googleSignedIn && (
                <>
                  Google: <strong>{calState.googleAccount?.email ?? 'connected'}</strong>
                </>
              )}
              {calState.lastSyncIso && (
                <span className="calendar-note"> · {lastSyncLabel(calState.lastSyncIso)}</span>
              )}
            </span>
            <div className="calendar-actions">
              <button type="button" disabled={syncing} onClick={() => void syncCalendar()}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
              {calState.msSignedIn && calState.error && (
                <button type="button" disabled={connecting} onClick={() => void connectCalendar()}>
                  {connecting ? 'Waiting for your browser…' : 'Sign in again'}
                </button>
              )}
              {!calState.msSignedIn && (
                <button type="button" disabled={connecting} onClick={() => void connectCalendar()}>
                  {connecting ? 'Waiting for your browser…' : 'Connect Microsoft'}
                </button>
              )}
              {calState.msSignedIn && (
                <button type="button" onClick={() => void disconnectCalendar()}>
                  Disconnect Microsoft
                </button>
              )}
              {!calState.googleSignedIn && (
                <button
                  type="button"
                  disabled={googleConnecting}
                  onClick={() => void connectGoogle()}
                >
                  {googleConnecting ? 'Waiting for your browser…' : 'Connect Google'}
                </button>
              )}
              {calState.googleSignedIn && (
                <button
                  type="button"
                  onClick={() => {
                    void window.calendar.disconnectGoogle().then(setCalState)
                  }}
                >
                  Disconnect Google
                </button>
              )}
            </div>

            <div className="cal-subcard">
              <div className="cal-subcard-head">Display</div>
              <div className="cal-row">
                <span className="cal-row-icon">
                  <MenuBarIcon />
                </span>
                <span className="cal-row-main">
                  <span className="cal-row-label">Show upcoming meetings in menu bar</span>
                  <span className="cal-row-sub">
                    Display your next meeting and time until it starts in the macOS menu bar
                  </span>
                </span>
                <Toggle
                  checked={calState.prefs.showMenuBar}
                  label="Show upcoming meetings in menu bar"
                  onChange={() => setCalPrefs({ showMenuBar: !calState.prefs.showMenuBar })}
                />
              </div>
              <div className="cal-row">
                <span className="cal-row-icon">
                  <PeopleIcon />
                </span>
                <span className="cal-row-main">
                  <span className="cal-row-label">Show events with no participants</span>
                  <span className="cal-row-sub">
                    &ldquo;Coming up&rdquo; section will include events without participants or a
                    video link
                  </span>
                </span>
                <Toggle
                  checked={calState.prefs.showNoParticipants}
                  label="Show events with no participants"
                  onChange={() =>
                    setCalPrefs({ showNoParticipants: !calState.prefs.showNoParticipants })
                  }
                />
              </div>
            </div>

            <div className="cal-subcard">
              <div className="cal-subcard-head">
                Visible calendars
                <button
                  type="button"
                  className="link-btn cal-reset"
                  title="Back to your default calendar only"
                  onClick={() => setCalPrefs({ visibleCalendarIds: null })}
                >
                  Reset
                </button>
              </div>
              {calState.calendars.length === 0 ? (
                <div className="cal-row">
                  <span className="calendar-note">
                    No calendars synced yet — hit Sync now above
                  </span>
                </div>
              ) : (
                calState.calendars.map((cal) => {
                  const visible = visibleCalendarIds(calState)
                  const isOn = visible.has(cal.id)
                  const lastOne = isOn && visible.size === 1
                  return (
                    <div key={cal.id} className="cal-row">
                      <span
                        className="cal-dot"
                        style={{ background: cal.colorHex }}
                        aria-hidden="true"
                      />
                      <span className="cal-row-main">
                        <span className="cal-row-label">{cal.name}</span>
                      </span>
                      <Toggle
                        checked={isOn}
                        disabled={lastOne}
                        label={`Show ${cal.name} in Coming up`}
                        title={lastOne ? 'At least one calendar stays visible' : undefined}
                        onChange={() => toggleCalendar(calState, cal.id)}
                      />
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </section>
          )}

          {section === 'general' && (
            <>
      <section className="keys-section">
        <h3>Appearance</h3>
        <div className="theme-seg" role="radiogroup" aria-label="Appearance">
          {(
            [
              ['system', 'Match system'],
              ['light', 'Light'],
              ['dark', 'Dark']
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              className={theme === value ? 'theme-seg-btn on' : 'theme-seg-btn'}
              onClick={() => {
                setThemePref(value)
                setTheme(value)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="keys-section">
        <h3>Updates</h3>
        <div className="cal-subcard">
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">
                DoodleNote v{update?.currentVersion ?? '…'}
              </span>
              <span className="cal-row-sub">
                {update ? updateStatusLine(update) : 'loading…'}
              </span>
            </span>
            {update?.status === 'downloaded' ? (
              <button
                type="button"
                className="pill-btn"
                onClick={() => void window.updates.install()}
              >
                Restart to update
              </button>
            ) : (
              <button
                type="button"
                className="pill-btn"
                disabled={
                  checkPending ||
                  update?.supported === false ||
                  update?.status === 'checking' ||
                  update?.status === 'downloading'
                }
                onClick={() => void checkForUpdates()}
              >
                Check for updates
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="keys-section calendar-section">
        <h3>Meeting detection</h3>
        <p className="models-sub">
          DoodleNote already nudges you when a calendar meeting starts. These make sure it never
          misses one.
        </p>
        {detect === null ? (
          <span className="calendar-note">loading detection settings…</span>
        ) : (
          <div className="cal-subcard">
            <div className="cal-row">
              <span className="cal-row-main">
                <span className="cal-row-label">Start DoodleNote at login</span>
                <span className="cal-row-sub">
                  Keeps meeting prompts working without remembering to open the app
                </span>
              </span>
              <Toggle
                checked={detect.loginItem}
                label="Start DoodleNote at login"
                onChange={() => {
                  void window.detect.setPrefs({ loginItem: !detect.loginItem }).then(setDetect)
                }}
              />
            </div>
            <div className="cal-row">
              <span className="cal-row-main">
                <span className="cal-row-label">Detect meetings from mic activity</span>
                <span className="cal-row-sub">
                  Prompts when a meeting app — Zoom, Teams, Webex, Slack, FaceTime, or a browser
                  — holds your microphone, even without a calendar event. Dictation tools are
                  ignored.
                </span>
              </span>
              <Toggle
                checked={detect.micDetect}
                label="Detect meetings from mic activity"
                onChange={() => {
                  void window.detect.setPrefs({ micDetect: !detect.micDetect }).then(setDetect)
                }}
              />
            </div>
            <div className="cal-row">
              <span className="cal-row-main">
                <span className="cal-row-label">Stop recording when the meeting ends</span>
                <span className="cal-row-sub">
                  When the meeting app hangs up, DoodleNote stops recording on its own — no more
                  minutes of empty audio after everyone leaves
                </span>
              </span>
              <Toggle
                checked={detect.autoStop}
                label="Stop recording when the meeting ends"
                onChange={() => {
                  void window.detect.setPrefs({ autoStop: !detect.autoStop }).then(setDetect)
                }}
              />
            </div>
          </div>
        )}
      </section>
            </>
          )}

          {section === 'sync' && (
      <section className="keys-section calendar-section">
        <h3>Sync with cloud</h3>
        <p className="models-sub">
          Off by default — your meetings live only on this Mac. Turn it on to push meetings,
          transcripts, and notes to your DoodleNote workspace so you can browse and share them on
          the web.
        </p>

        {syncStatus?.lastError && <div className="models-error">{syncStatus.lastError}</div>}

        {syncStatus === null ? (
          <span className="calendar-note">loading sync settings…</span>
        ) : !syncStatus.connected ? (
          <div className="calendar-actions">
            <button
              type="button"
              className="ms-signin"
              disabled={linkPending || syncStatus.linking}
              onClick={() => void connectSync()}
            >
              <span>
                {linkPending || syncStatus.linking
                  ? 'Waiting for your browser…'
                  : 'Connect DoodleNote Cloud'}
              </span>
            </button>
            {(linkPending || syncStatus.linking) && (
              <span className="calendar-note">
                approve the connection in your browser, then come back
              </span>
            )}
          </div>
        ) : (
          <div className="calendar-connected">
            <span className="calendar-status">
              Connected as <strong>{syncStatus.email ?? 'your account'}</strong>
              {syncStatus.workspaceName && (
                <span className="calendar-note"> · workspace “{syncStatus.workspaceName}”</span>
              )}
              {syncStatus.lastSyncAt && (
                <span className="calendar-note"> · {lastSyncLabel(syncStatus.lastSyncAt)}</span>
              )}
            </span>

            <div className="cal-subcard">
              <div className="cal-row">
                <span className="cal-row-main">
                  <span className="cal-row-label">Sync meetings to the cloud</span>
                  <span className="cal-row-sub">
                    {syncStatus.enabled
                      ? syncStatus.syncing
                        ? 'Syncing now…'
                        : syncStatus.pendingCount > 0
                          ? `${syncStatus.pendingCount} meeting${syncStatus.pendingCount === 1 ? '' : 's'} waiting to sync`
                          : 'Everything is synced'
                      : 'Paused — nothing is uploaded while this is off'}
                  </span>
                </span>
                <Toggle
                  checked={syncStatus.enabled}
                  label="Sync meetings to the cloud"
                  onChange={() => {
                    void window.sync.setEnabled(!syncStatus.enabled).then(setSyncStatus)
                  }}
                />
              </div>
            </div>

            <div className="calendar-actions">
              <button
                type="button"
                disabled={syncStatus.syncing || !syncStatus.enabled}
                onClick={() => {
                  void window.sync.syncNow().then(setSyncStatus)
                }}
              >
                {syncStatus.syncing ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void window.sync.disconnect().then(setSyncStatus)
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </section>
          )}

          {section === 'model' && (
      <section className="keys-section">
        <h3>AI keys (optional)</h3>
        <p className="models-sub">
          On-device is the default and needs no account. Add your own API key only if you want
          cloud-quality notes — the key is encrypted with the macOS keychain and never shown again.
        </p>

        <div className="engine-choice">
          <label>
            <input
              type="radio"
              name="engine-choice"
              checked={engineChoice === 'local'}
              onChange={() => void chooseEngine('local')}
            />
            On-device (default)
          </label>
          <label>
            <input
              type="radio"
              name="engine-choice"
              checked={engineChoice === 'cloud'}
              onChange={() => void chooseEngine('cloud')}
            />
            Cloud with my key
            {engineChoice === 'cloud' && !settings?.cloud?.hasKey && (
              <span className="model-note"> (no key saved yet — on-device will be used)</span>
            )}
          </label>
        </div>

        <div className="key-form">
          <select value={provider} onChange={(e) => setProvider(e.target.value as CloudProvider)}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
          <input
            type="text"
            spellCheck={false}
            placeholder="model (optional, e.g. claude-sonnet-5)"
            value={cloudModel}
            onChange={(e) => setCloudModel(e.target.value)}
          />
          <input
            type="password"
            placeholder={settings?.cloud?.hasKey ? '••••••••  (key saved)' : 'API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button type="button" onClick={() => void saveCloudKey()}>
            Save
          </button>
          {(keySaved || settings?.cloud?.hasKey) && <span className="key-saved">key saved ✓</span>}
        </div>
      </section>
          )}
        </div>
      </div>
    </div>
  )
}
