import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FolderRecord } from '../../shared/folders-api'
import type { MeetingSummary } from '../../shared/meetings-api'
import DevConsole from './DevConsole'
import HomeView, { type HomeFilter } from './HomeView'
import MeetingView from './MeetingView'
import ModelsView from './ModelsView'
import mascotUrl from './assets/doodlenote-logo.png'

type ViewId = 'home' | 'editor' | 'settings' | 'dev'

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
  const [newFolderName, setNewFolderName] = useState('')
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

  const newMeeting = useCallback(async (): Promise<void> => {
    const id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    await window.meetings.upsert({
      id,
      title: '',
      createdAt: new Date().toISOString(),
      rawNotesMarkdown: '',
      segments: [],
      echoSuppressed: 0
    })
    // Fresh meetings start recording immediately; opening an existing
    // meeting from the list never does.
    setAutoRecordId(id)
    openMeeting(id)
  }, [openMeeting])

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
              <span className="mascot">
                <img src={mascotUrl} alt="" draggable={false} />
              </span>
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
              <span className="nav-icon">⌂</span> Home
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
              <span className="nav-icon">✎</span>
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
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                className={
                  onHome && filter.kind === 'folder' && filter.id === f.id
                    ? 'nav-item nav-sub on'
                    : 'nav-item nav-sub'
                }
                onClick={() => selectFilter({ kind: 'folder', id: f.id })}
              >
                <span className="nav-icon">📁</span>
                <span className="nav-label">{f.name}</span>
                <span className="nav-count">{folderCounts.get(f.id) ?? 0}</span>
              </button>
            ))}
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
              <span className="nav-icon">🗑</span>
              <span className="nav-label">Trash</span>
              {trashCount > 0 && <span className="nav-count">{trashCount}</span>}
            </button>
          </nav>

          <div className="sidebar-spacer" />

          <div className="sidebar-bottom">
            <div className="privacy-badge">🔒 Local &amp; private</div>
            <button
              type="button"
              className={view === 'settings' ? 'nav-item on' : 'nav-item'}
              onClick={() => setView('settings')}
            >
              <span className="nav-icon">⚙</span> Settings
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
              onOpenMeeting={openMeeting}
              onNewMeeting={() => void newMeeting()}
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
    </div>
  )
}

export default App
