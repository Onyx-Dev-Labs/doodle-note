import { useCallback, useEffect, useRef, useState } from 'react'
import DevConsole from './DevConsole'
import HomeView from './HomeView'
import MeetingView from './MeetingView'
import ModelsView from './ModelsView'
import mascotUrl from './assets/doodlenote-logo.png'

type ViewId = 'home' | 'editor' | 'settings' | 'dev'

/**
 * View state lives here (no router). The editor stays mounted while a
 * meeting is open — even when the user navigates Home — so a running live
 * capture keeps streaming into that meeting's document.
 */
function App(): React.JSX.Element {
  const [view, setView] = useState<ViewId>('home')
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [homeRefresh, setHomeRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

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
    openMeeting(id)
  }, [openMeeting])

  const goHome = useCallback(() => {
    setView('home')
    setHomeRefresh((n) => n + 1)
  }, [])

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

  const chromeVisible = view !== 'editor'

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
              className={view === 'home' ? 'nav-item on' : 'nav-item'}
              onClick={goHome}
            >
              <span className="nav-icon">⌂</span> Home
            </button>
          </nav>

          <div className="sidebar-section">Spaces</div>
          <nav className="sidebar-nav">
            <button type="button" className="nav-item" onClick={goHome}>
              <span className="nav-icon">✎</span> My notes
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
              active={view === 'home'}
              refreshToken={homeRefresh}
              search={search}
              onOpenMeeting={openMeeting}
              onNewMeeting={() => void newMeeting()}
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
            onBack={goHome}
            onOpenSettings={() => setView('settings')}
          />
        </div>
      )}
    </div>
  )
}

export default App
