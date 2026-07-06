import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CalendarEvent,
  CalendarStartMeetingEvent,
  CalendarState
} from '../../shared/calendar-api'
import type { FolderRecord } from '../../shared/folders-api'
import type { MeetingSummary } from '../../shared/meetings-api'
import DevConsole from './DevConsole'
import HomeView, { type HomeFilter } from './HomeView'
import MeetingView from './MeetingView'
import ModelsView from './ModelsView'
import mascotUrl from './assets/mascot-square.png'
import {
  CalendarIcon,
  FolderIcon,
  GearIcon,
  HomeIcon,
  LockIcon,
  MicIcon,
  PencilIcon,
  TrashIcon
} from './icons'

type ViewId = 'home' | 'editor' | 'settings' | 'dev'

/** The "meeting is starting" banner disappears 10 min past the start. */
const BANNER_TTL_PAST_START_MS = 10 * 60_000

/**
 * View state lives here (no router). The editor stays mounted while a
 * meeting is open — even when the user navigates Home — so a running live
 * capture keeps streaming into that meeting's document.
 *
 * App also owns the Home data (meeting summaries + folders): the sidebar
 * needs folder/trash counts and HomeView needs the filtered list, so both
 * read the same fetch, re-run whenever homeRefresh bumps.
 */
function App(): React.JSX.Element {
  const [view, setView] = useState<ViewId>('home')
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [autoRecordId, setAutoRecordId] = useState<string | null>(null)
  const [homeRefresh, setHomeRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<HomeFilter>({ kind: 'all' })
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null)
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<{ id: string; name: string } | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [calendar, setCalendar] = useState<CalendarState | null>(null)
  const [banner, setBanner] = useState<CalendarStartMeetingEvent | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.meetings
      .list()
      .then((list) => {
        if (!cancelled) setMeetings(list)
      })
      .catch(() => {
        if (!cancelled) setMeetings([])
      })
    void window.folders
      .list()
      .then((list) => {
        if (!cancelled) setFolders(list)
      })
      .catch(() => {
        if (!cancelled) setFolders([])
      })
    return () => {
      cancelled = true
    }
  }, [homeRefresh])

  const refreshHome = useCallback(() => {
    setHomeRefresh((n) => n + 1)
  }, [])

  const openMeeting = useCallback((id: string) => {
    setMeetingId(id)
    setView('editor')
  }, [])

  const newMeeting = useCallback(
    async (prefill?: {
      title?: string
      calendarEventId?: string
      kind?: 'note'
    }): Promise<void> => {
      const id =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      await window.meetings.upsert({
        id,
        ...(prefill?.kind === 'note' ? { kind: 'note' as const } : {}),
        title: prefill?.title ?? '',
        createdAt: new Date().toISOString(),
        rawNotesMarkdown: '',
        segments: [],
        echoSuppressed: 0,
        ...(prefill?.calendarEventId ? { calendarEventId: prefill.calendarEventId } : {})
      })
      // Fresh meetings start recording immediately; opening an existing
      // meeting from the list never does. Quick notes never auto-record —
      // typing is their default, the rec pill is there when wanted.
      if (prefill?.kind !== 'note') setAutoRecordId(id)
      openMeeting(id)
    },
    [openMeeting]
  )

  /**
   * "Take notes" for a calendar event (banner button, notification click or
   * the Coming up row): reuse the exact + New meeting flow, pre-titled from
   * the event. If a meeting was already created for this event, reopen it
   * instead of minting a duplicate.
   */
  const startCalendarMeeting = useCallback(
    async (ev: { eventId: string; subject: string }): Promise<void> => {
      setBanner((b) => (b !== null && b.eventId === ev.eventId ? null : b))
      try {
        const list = await window.meetings.list()
        const existing = list.find((m) => m.calendarEventId === ev.eventId && !m.trashedAt)
        if (existing) {
          openMeeting(existing.id)
          return
        }
        await newMeeting({
          title: ev.subject.trim() || 'Untitled meeting',
          calendarEventId: ev.eventId
        })
      } catch {
        // Creation failed — the user can still start one manually.
      }
    },
    [newMeeting, openMeeting]
  )

  const startFromCalendarEvent = useCallback(
    (event: CalendarEvent): void => {
      void startCalendarMeeting({ eventId: event.id, subject: event.subject })
    },
    [startCalendarMeeting]
  )

  /* ---- calendar state + meeting-start prompts (window.calendar) ---- */

  useEffect(() => {
    let cancelled = false
    void window.calendar
      .getState()
      .then((state) => {
        if (!cancelled) setCalendar(state)
      })
      .catch(() => {
        if (!cancelled) setCalendar(null)
      })
    const unsubscribe = window.calendar.onEvents(setCalendar)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(
    () =>
      window.calendar.onStartMeeting((ev) => {
        if (ev.action === 'start') {
          // OS notification click: the one click already happened.
          void startCalendarMeeting(ev)
        } else {
          // Watcher prompt: the banner is the guaranteed path.
          setBanner(ev)
        }
      }),
    [startCalendarMeeting]
  )

  // The banner takes itself down 10 minutes past the meeting's start.
  useEffect(() => {
    if (banner === null) return
    const expiresAt = Date.parse(banner.startIso) + BANNER_TTL_PAST_START_MS
    const remaining = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : 0
    const timer = setTimeout(() => setBanner(null), remaining)
    return () => clearTimeout(timer)
  }, [banner])

  const goHome = useCallback(() => {
    setView('home')
    setHomeRefresh((n) => n + 1)
  }, [])

  /** Sidebar navigation: pick what the Home list shows, then go there. */
  const selectFilter = useCallback(
    (next: HomeFilter) => {
      setFilter(next)
      goHome()
    },
    [goHome]
  )

  const submitNewFolder = useCallback(async (): Promise<void> => {
    const name = newFolderName.trim()
    setCreatingFolder(false)
    setNewFolderName('')
    if (name.length === 0) return
    try {
      await window.folders.create(name)
      refreshHome()
    } catch {
      // Creation failed (e.g. bad name) — nothing to clean up.
    }
  }, [newFolderName, refreshHome])

  const submitRename = useCallback(async (): Promise<void> => {
    const target = renamingFolder
    setRenamingFolder(null)
    if (!target) return
    const name = target.name.trim()
    if (name.length === 0) return
    try {
      await window.folders.rename(target.id, name)
      refreshHome()
    } catch {
      // Rename failed; the old name stands.
    }
  }, [renamingFolder, refreshHome])

  const deleteFolder = useCallback(
    async (id: string): Promise<void> => {
      setFolderMenuId(null)
      const folder = folders.find((f) => f.id === id)
      const ok = window.confirm(
        `Delete "${folder?.name ?? 'this folder'}"? Its meetings move back to My notes.`
      )
      if (!ok) return
      try {
        await window.folders.remove(id)
        if (filter.kind === 'folder' && filter.id === id) setFilter({ kind: 'all' })
        refreshHome()
      } catch {
        // Deletion failed; nothing changed.
      }
    },
    [folders, filter, refreshHome]
  )

  // The folder ⋯ menu closes on any outside click or Escape.
  useEffect(() => {
    if (folderMenuId === null) return
    const close = (): void => setFolderMenuId(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [folderMenuId])

  // ⌘K focuses the sidebar search (when the sidebar is visible).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---- sidebar counts (folders show non-trashed meetings only) ---- */

  const folderCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of meetings ?? []) {
      if (m.trashedAt || !m.folderId) continue
      map.set(m.folderId, (map.get(m.folderId) ?? 0) + 1)
    }
    return map
  }, [meetings])

  const trashCount = useMemo(() => (meetings ?? []).filter((m) => m.trashedAt).length, [meetings])

  const chromeVisible = view !== 'editor'
  const onHome = view === 'home'

  return (
    <div className="shell">
      <div className={chromeVisible ? 'chrome' : 'chrome hidden'}>
        <aside className="sidebar">
          <div className="sidebar-top drag">
            <div className="wordmark no-drag" onClick={goHome} role="button" tabIndex={0}>
              <img className="mascot-img" src={mascotUrl} alt="" draggable={false} />
              <span className="wordmark-text">
                <span className="wm-doodle">Doodle</span>
                <span className="wm-note">Note</span>
              </span>
            </div>
          </div>

          <div className="sidebar-search">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search"
              spellCheck={false}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="kbd">⌘K</span>
          </div>

          <nav className="sidebar-nav">
            <button
              type="button"
              className={onHome && filter.kind === 'all' ? 'nav-item on' : 'nav-item'}
              onClick={() => selectFilter({ kind: 'all' })}
            >
              <span className="nav-icon">
                <HomeIcon size={14} />
              </span>{' '}
              Home
            </button>
          </nav>

          <div className="sidebar-section">Spaces</div>
          <nav className="sidebar-nav">
            <div
              role="button"
              tabIndex={0}
              className={
                onHome && filter.kind === 'all' ? 'nav-item space-item on' : 'nav-item space-item'
              }
              onClick={() => selectFilter({ kind: 'all' })}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  selectFilter({ kind: 'all' })
                }
              }}
            >
              <span className="nav-icon">
                <PencilIcon size={13} />
              </span>
              <span className="nav-label">My notes</span>
              <button
                type="button"
                className="folder-add"
                title="Create folder"
                aria-label="Create folder"
                onClick={(e) => {
                  e.stopPropagation()
                  setCreatingFolder(true)
                }}
              >
                ＋
              </button>
            </div>
            {folders.map((f) =>
              renamingFolder?.id === f.id ? (
                <div key={f.id} className="folder-new nav-sub">
                  <input
                    autoFocus
                    value={renamingFolder.name}
                    onChange={(e) => setRenamingFolder({ id: f.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitRename()
                      if (e.key === 'Escape') setRenamingFolder(null)
                    }}
                    onBlur={() => setRenamingFolder(null)}
                  />
                </div>
              ) : (
                <div
                  key={f.id}
                  role="button"
                  tabIndex={0}
                  className={
                    onHome && filter.kind === 'folder' && filter.id === f.id
                      ? 'nav-item nav-sub folder-row on'
                      : 'nav-item nav-sub folder-row'
                  }
                  onClick={() => selectFilter({ kind: 'folder', id: f.id })}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      selectFilter({ kind: 'folder', id: f.id })
                    }
                  }}
                >
                  <span className="nav-icon">
                    <FolderIcon size={13} />
                  </span>
                  <span className="nav-label">{f.name}</span>
                  <span className="nav-count">{folderCounts.get(f.id) ?? 0}</span>
                  <button
                    type="button"
                    className="folder-menu-btn"
                    title="Folder options"
                    aria-label="Folder options"
                    onClick={(e) => {
                      e.stopPropagation()
                      setFolderMenuId((v) => (v === f.id ? null : f.id))
                    }}
                  >
                    ⋯
                  </button>
                  {folderMenuId === f.id && (
                    <div className="folder-menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          setFolderMenuId(null)
                          setCreatingFolder(true)
                        }}
                      >
                        ⊕ Create folder
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFolderMenuId(null)
                          setRenamingFolder({ id: f.id, name: f.name })
                        }}
                      >
                        <PencilIcon size={12} /> Rename
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void deleteFolder(f.id)}
                      >
                        <TrashIcon size={12} /> Delete folder
                      </button>
                    </div>
                  )}
                </div>
              )
            )}
            {creatingFolder && (
              <div className="folder-new nav-sub">
                <input
                  type="text"
                  placeholder="Folder name"
                  spellCheck={false}
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void submitNewFolder()
                    } else if (e.key === 'Escape') {
                      setCreatingFolder(false)
                      setNewFolderName('')
                    }
                  }}
                  onBlur={() => {
                    setCreatingFolder(false)
                    setNewFolderName('')
                  }}
                />
              </div>
            )}
          </nav>

          <nav className="sidebar-nav sidebar-trash">
            <button
              type="button"
              className={onHome && filter.kind === 'trash' ? 'nav-item on' : 'nav-item'}
              onClick={() => selectFilter({ kind: 'trash' })}
            >
              <span className="nav-icon">
                <TrashIcon size={13} />
              </span>
              <span className="nav-label">Trash</span>
              {trashCount > 0 && <span className="nav-count">{trashCount}</span>}
            </button>
          </nav>

          <div className="sidebar-spacer" />

          <div className="sidebar-bottom">
            <div className="privacy-badge">
              <LockIcon size={12} /> Local &amp; private
            </div>
            <button
              type="button"
              className={view === 'settings' ? 'nav-item on' : 'nav-item'}
              onClick={() => setView('settings')}
            >
              <span className="nav-icon">
                <GearIcon size={14} />
              </span>{' '}
              Settings
            </button>
            <button type="button" className="dev-link" onClick={() => setView('dev')}>
              Developer
            </button>
          </div>
        </aside>

        <main className="content">
          <div className={view === 'home' ? 'content-slot' : 'content-slot hidden'}>
            <HomeView
              meetings={meetings}
              folders={folders}
              filter={filter}
              search={search}
              calendar={calendar}
              onStartCalendarMeeting={startFromCalendarEvent}
              onOpenMeeting={openMeeting}
              onNewMeeting={() => void newMeeting()}
              onNewNote={() => void newMeeting({ kind: 'note' })}
              onChanged={refreshHome}
              onOpenSettings={() => setView('settings')}
            />
          </div>
          <div className={view === 'settings' ? 'content-slot' : 'content-slot hidden'}>
            <ModelsView active={view === 'settings'} />
          </div>
          <div className={view === 'dev' ? 'content-slot' : 'content-slot hidden'}>
            <DevConsole />
          </div>
        </main>
      </div>

      {meetingId !== null && (
        <div className={view === 'editor' ? 'editor-host' : 'editor-host hidden'}>
          <MeetingView
            key={meetingId}
            meetingId={meetingId}
            visible={view === 'editor'}
            autoRecord={meetingId === autoRecordId}
            onAutoRecordStarted={() => setAutoRecordId(null)}
            onBack={goHome}
            onOpenSettings={() => setView('settings')}
          />
        </div>
      )}

      {/* "Meeting is starting" toast: fixed top-center so it shows over Home
          and the editor alike; the OS notification is only best-effort. */}
      {banner !== null && (
        <div className="meeting-banner no-drag" role="status">
          <span className="mb-emoji" aria-hidden="true">
            {banner.adHoc ? <MicIcon size={15} /> : <CalendarIcon size={15} />}
          </span>
          <span className="mb-text">
            {banner.adHoc ? (
              <>Looks like you&rsquo;re in a meeting</>
            ) : (
              <>
                <strong>{banner.subject}</strong> is starting
              </>
            )}
          </span>
          <button
            type="button"
            className="mb-start"
            onClick={() => void startCalendarMeeting(banner)}
          >
            Start taking notes
          </button>
          <button type="button" className="mb-dismiss" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

export default App
