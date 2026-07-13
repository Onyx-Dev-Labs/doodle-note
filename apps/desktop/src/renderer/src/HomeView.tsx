import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarEvent, CalendarState } from '../../shared/calendar-api'
import type { FolderRecord } from '../../shared/folders-api'
import type { MeetingSearchHit, MeetingSummary } from '../../shared/meetings-api'
import type {
  GlobalChatEntry,
  NotesModelsResponse,
  NotesSettingsView
} from '../../shared/notes-api'
import FolderPicker from './FolderPicker'
import { CheckSquareIcon, DocIcon, FolderIcon, PencilIcon, TrashIcon } from './icons'
import { markdownToHtml } from './lib/markdown'
import mascotUrl from './assets/mascot-square.png'

/** Which meetings the Home list shows; lives in App next to `search`. */
export type HomeFilter = { kind: 'all' } | { kind: 'trash' } | { kind: 'folder'; id: string }

/** Canned question behind the "☑ List recent todos" chip. */
const RECENT_TODOS_QUESTION =
  "List my outstanding action items from recent meetings, grouped by meeting (newest first), keeping each item's owner."

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/* ---- "Coming up" card (Microsoft 365 events) ---- */

/** Events starting within this window (or in progress) get a Take notes button. */
const TAKE_NOTES_LEAD_MS = 10 * 60_000

/** The card shows two days at a time (today + tomorrow); chevrons page by two… */
const DAYS_PER_PAGE = 2
/** …across the service's 14-day fetch: page 0 = days 0–1 … page 6 = days 12–13. */
const LAST_PAGE = 6

const DAY_MS = 86_400_000

/** "9:00 – 10:00 AM": the first meridiem is dropped when both sides share it. */
function timeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string): string =>
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  let start = fmt(startIso)
  const end = fmt(endIso)
  const meridiem = /\s*([AP]M)\s*$/i
  const startM = meridiem.exec(start)?.[1]?.toUpperCase()
  const endM = meridiem.exec(end)?.[1]?.toUpperCase()
  if (startM !== undefined && startM === endM) start = start.replace(meridiem, '')
  return `${start} – ${end}`
}

/** "7/6/2026, 7:00 PM – 7/7/2026, 7:00 PM" for events spanning days. */
function multiDayRange(startIso: string, endIso: string): string {
  const fmt = (iso: string): string => {
    const d = new Date(iso)
    const date = d.toLocaleDateString(undefined, {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric'
    })
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    return `${date}, ${time}`
  }
  return `${fmt(startIso)} – ${fmt(endIso)}`
}

/** All day / same-day range / multi-day range, per event shape. */
function eventTimeLabel(event: CalendarEvent): string {
  if (event.isAllDay) return 'All day'
  const start = new Date(event.startIso)
  const end = new Date(event.endIso)
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate()
  return sameDay
    ? timeRange(event.startIso, event.endIso)
    : multiDayRange(event.startIso, event.endIso)
}

interface ComingUpDay {
  key: string
  dayNum: string
  month: string
  weekday: string
  isToday: boolean
  events: CalendarEvent[]
}

function dayBucket(dayMs: number, todayMs: number, events: CalendarEvent[]): ComingUpDay {
  const d = new Date(dayMs)
  return {
    key: String(dayMs),
    dayNum: String(d.getDate()),
    month: d.toLocaleDateString(undefined, { month: 'short' }),
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    isToday: dayMs === todayMs,
    events
  }
}

/** The date-rail day an event renders under: its start day, clamped to today
 *  for in-progress multi-day events that began earlier. */
function displayDayMs(event: CalendarEvent, todayMs: number): number {
  return Math.max(startOfDay(new Date(event.startIso)), todayMs)
}

/** Group already-sorted events into day buckets for the date-rail layout. */
function groupEventsByDay(events: CalendarEvent[], todayMs: number): ComingUpDay[] {
  const days: ComingUpDay[] = []
  for (const event of events) {
    const dayMs = displayDayMs(event, todayMs)
    const last = days[days.length - 1]
    if (last && last.key === String(dayMs)) {
      last.events.push(event)
    } else {
      days.push(dayBucket(dayMs, todayMs, [event]))
    }
  }
  return days
}

function SlidersIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="1.5" y1="4.5" x2="14.5" y2="4.5" />
      <line x1="1.5" y1="11.5" x2="14.5" y2="11.5" />
      <circle cx="6" cy="4.5" r="2" fill="var(--card)" />
      <circle cx="10.5" cy="11.5" r="2" fill="var(--card)" />
    </svg>
  )
}

/** The Home "Coming up" slot: serif heading outside the card with calendar
 *  settings + week-paging controls; inside, a date rail (today dot, month)
 *  and per-calendar-colored event rows when signed in; a "Connect calendar"
 *  nudge otherwise. */
function ComingUpCard({
  calendar,
  onStart,
  onOpenSettings
}: {
  calendar: CalendarState | null
  onStart: (event: CalendarEvent) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [page, setPage] = useState(0)

  const signedIn = calendar?.signedIn === true

  const events = useMemo(() => {
    if (!calendar?.signedIn) return []
    // Drop events that already ended (stale cache between syncs).
    return calendar.events.filter((e) => {
      const end = Date.parse(e.endIso)
      return Number.isFinite(end) && end > nowMs
    })
  }, [calendar, nowMs])

  // The Take notes / Join affordances are time-sensitive: tick every 30s
  // while there is anything to show.
  useEffect(() => {
    if (events.length === 0) return
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [events.length])

  const header = (
    <div className="cu-head">
      <h2 className="home-heading">Coming up</h2>
      {signedIn && (
        <div className="cu-controls">
          <button
            type="button"
            className="cu-ctl"
            title="Calendar settings"
            aria-label="Calendar settings"
            onClick={onOpenSettings}
          >
            <SlidersIcon />
          </button>
          <button
            type="button"
            className="cu-ctl"
            disabled={page === 0}
            title="Earlier days"
            aria-label="Earlier days"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="cu-ctl"
            disabled={page === LAST_PAGE}
            title="Later days"
            aria-label="Later days"
            onClick={() => setPage((p) => Math.min(LAST_PAGE, p + 1))}
          >
            ›
          </button>
        </div>
      )}
    </div>
  )

  if (!signedIn) {
    return (
      <>
        {header}
        <div className="card coming-up">
          <div className="coming-up-empty">
            Connect your calendar to see your meetings here —{' '}
            <button type="button" className="link-btn" onClick={onOpenSettings}>
              Connect calendar →
            </button>
          </div>
        </div>
      </>
    )
  }

  const todayMs = startOfDay(new Date(nowMs))
  const windowStart = todayMs + page * DAYS_PER_PAGE * DAY_MS
  const windowEnd = windowStart + DAYS_PER_PAGE * DAY_MS
  const pageEvents = events.filter((e) => {
    const dayMs = displayDayMs(e, todayMs)
    return dayMs >= windowStart && dayMs < windowEnd
  })
  const days = groupEventsByDay(pageEvents, todayMs)
  // Today always renders — as a muted "No events today" row when empty.
  if (page === 0 && days[0]?.isToday !== true) {
    days.unshift(dayBucket(todayMs, todayMs, []))
  }

  return (
    <>
      {header}
      <div className="card coming-up has-events">
        {days.length === 0 ? (
          <div className="coming-up-empty">Nothing scheduled these days</div>
        ) : (
          days.map((day) => (
            <div key={day.key} className="cu-day">
              <div className="cu-date">
                <span className="cu-date-num">{day.dayNum}</span>
                <span className="cu-date-month">{day.month}</span>
                <span className="cu-date-wd">{day.weekday}</span>
                {day.isToday && <span className="cu-today-dot" aria-hidden="true" />}
              </div>
              <div className="cu-events">
                {day.events.length === 0 ? (
                  <div className="cu-event">
                    <span className="cu-bar cu-bar-muted" aria-hidden="true" />
                    <span className="cu-main">
                      <span className="cu-no-events">No events today</span>
                    </span>
                  </div>
                ) : (
                  day.events.map((event) => {
                    const startMs = Date.parse(event.startIso)
                    const canTakeNotes = !event.isAllDay && startMs - nowMs <= TAKE_NOTES_LEAD_MS
                    return (
                      <div key={event.id} className="cu-event">
                        <span
                          className="cu-bar"
                          style={event.colorHex ? { background: event.colorHex } : undefined}
                          aria-hidden="true"
                        />
                        <span className="cu-main">
                          <span className="cu-subject">
                            {event.subject.trim() || 'Untitled meeting'}
                          </span>
                          <span className="cu-time">
                            {eventTimeLabel(event)}
                            {event.isOnlineMeeting && event.joinUrl !== undefined && (
                              <>
                                {' · '}
                                <button
                                  type="button"
                                  className="cu-join"
                                  title="Open the meeting link"
                                  onClick={() => window.open(event.joinUrl, '_blank')}
                                >
                                  Join
                                </button>
                              </>
                            )}
                          </span>
                        </span>
                        {canTakeNotes && (
                          <button
                            type="button"
                            className="cu-take-notes"
                            onClick={() => onStart(event)}
                          >
                            Take notes
                          </button>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}

/** Home: "Coming up" calendar slot + the day-grouped meetings list, filtered
 *  to everything / one folder / the trash, plus the cross-meeting "Ask
 *  anything" bar and chat panel. Data is owned by App; mutations here
 *  upsert/delete and then ask App to refetch via onChanged. */
export default function HomeView({
  meetings,
  folders,
  filter,
  search,
  calendar,
  onStartCalendarMeeting,
  onOpenMeeting,
  onNewMeeting,
  onNewNote,
  onChanged,
  onOpenSettings
}: {
  meetings: MeetingSummary[] | null
  folders: FolderRecord[]
  filter: HomeFilter
  search: string
  calendar: CalendarState | null
  onStartCalendarMeeting: (event: CalendarEvent) => void
  onOpenMeeting: (id: string) => void
  onNewMeeting: () => void
  onNewNote: () => void
  onChanged: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  /** Meeting id whose ⋯ menu is open, and whose folder picker is open. */
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  /** Transient share feedback: message shown as a toast under the topbar. */
  const [shareNotice, setShareNotice] = useState<string | null>(null)
  /** 'idle' | 'running' | an error message. */
  const [importState, setImportState] = useState<'idle' | 'running' | string>('idle')

  const exportMeeting = async (id: string, format: 'md' | 'pdf'): Promise<void> => {
    setMenuFor(null)
    try {
      const result = await window.exporter.exportMeeting(id, format)
      if (result.path) {
        setShareNotice(`Exported to ${result.path}`)
        setTimeout(() => setShareNotice(null), 4000)
      } else if (result.error) {
        setShareNotice(result.error)
        setTimeout(() => setShareNotice(null), 5000)
      }
    } catch (err) {
      setShareNotice(err instanceof Error ? err.message : String(err))
      setTimeout(() => setShareNotice(null), 5000)
    }
  }

  const runImport = async (): Promise<void> => {
    if (importState === 'running') return
    setImportState('running')
    try {
      const result = await window.importer.importAudio()
      setImportState('idle')
      if (result.meetingId) onOpenMeeting(result.meetingId)
      else if (result.error) setImportState(result.error)
    } catch (err) {
      setImportState(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (shareNotice === null) return
    const timer = setTimeout(() => setShareNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [shareNotice])

  const copyShareLink = async (id: string): Promise<void> => {
    setMenuFor(null)
    setShareNotice('Creating share link…')
    const result = await window.sync.share(id)
    if ('url' in result) {
      try {
        await navigator.clipboard.writeText(result.url)
        setShareNotice('Share link copied to clipboard ✓')
      } catch {
        setShareNotice(result.url) // clipboard blocked — at least show it
      }
    } else {
      setShareNotice(result.error)
    }
  }

  /* ---- cross-meeting "ask anything" (thread persisted by main) ---- */
  const [chatOpen, setChatOpen] = useState(false)
  const [chatThread, setChatThread] = useState<GlobalChatEntry[]>([])
  const [askText, setAskText] = useState('')
  /** The question currently being answered; null when no ask is in flight. */
  const [askPending, setAskPending] = useState<string | null>(null)
  const [chatCopied, setChatCopied] = useState<number | null>(null)
  const [askStreamed, setAskStreamed] = useState('')
  const [askError, setAskError] = useState<string | null>(null)
  const [modelsInfo, setModelsInfo] = useState<NotesModelsResponse | null>(null)
  const [settings, setSettings] = useState<NotesSettingsView | null>(null)
  const chatFeedRef = useRef<HTMLDivElement>(null)

  const inTrash = filter.kind === 'trash'
  /** The ask bar lives in 'all' and 'folder' views, never in the trash. */
  const askVisible = !inTrash

  // Close the ⋯ menu on any outside click or Escape. (FolderPicker manages
  // its own dismissal the same way.)
  useEffect(() => {
    if (menuFor === null) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      if (target?.closest('.row-menu') || target?.closest('.row-menu-btn')) return
      setMenuFor(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuFor(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuFor])

  /* ---- ask-anything plumbing ---- */

  // Hydrate the persisted Home-level conversation once.
  useEffect(() => {
    let cancelled = false
    void window.notes
      .getGlobalChat()
      .then((entries) => {
        if (!cancelled) setChatThread(entries)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () =>
      window.notes.onGlobalAskToken(({ token }) => {
        setAskStreamed((s) => s + token)
      }),
    []
  )

  // Escape closes the chat panel (the bar itself stays).
  useEffect(() => {
    if (!chatOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setChatOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [chatOpen])

  // Keep the newest exchange in view while the thread grows / streams.
  useEffect(() => {
    const el = chatFeedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatThread, askPending, askStreamed, askError, chatOpen])

  /** Models/settings meta — only drives the "Open Settings →" affordance. */
  const refreshNotesMeta = useCallback(() => {
    void window.notes
      .models()
      .then(setModelsInfo)
      .catch(() => setModelsInfo(null))
    void window.notes
      .getSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [])

  useEffect(() => {
    refreshNotesMeta()
  }, [refreshNotesMeta])

  const submitAsk = async (preset?: string): Promise<void> => {
    if (askPending !== null) return
    const question = (preset ?? askText).trim()
    if (question.length === 0) return
    refreshNotesMeta()
    setAskError(null)
    setAskStreamed('')
    setAskPending(question)
    if (preset === undefined) setAskText('')
    setChatOpen(true)

    // Main gathers the cross-meeting context and history itself.
    const result = await window.notes.askGlobal({ question })
    if (result.error !== undefined || result.answer === undefined) {
      setAskError(result.error ?? 'The model returned no answer.')
      setAskPending(null)
      setAskStreamed('')
      // Put the question back so a retry is one keypress away.
      setAskText((current) => (current.trim().length > 0 ? current : question))
      return
    }
    const entry: GlobalChatEntry = {
      question,
      answer: result.answer,
      askedAt: new Date().toISOString()
    }
    setChatThread((thread) => [...thread, entry])
    setAskPending(null)
    setAskStreamed('')
  }

  const clearChat = (): void => {
    setChatThread([])
    setAskError(null)
    void window.notes.clearGlobalChat().catch(() => {})
  }

  const anyDownloaded = modelsInfo?.models.some((m) => m.downloaded) ?? false
  const cloudReady = settings?.engineChoice === 'cloud' && settings.cloud?.hasKey === true
  const modelReady = cloudReady || anyDownloaded

  /** Full-text hits for the current query (id → matched field); null while
   *  the query is empty. Debounced main-process scan. */
  const [searchHits, setSearchHits] = useState<Map<string, MeetingSearchHit['field']> | null>(null)

  useEffect(() => {
    const q = search.trim()
    if (q.length === 0) {
      setSearchHits(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.meetings.search(q).then((hits) => {
        if (cancelled) return
        setSearchHits(new Map(hits.map((h) => [h.id, h.field])))
      })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search])

  const visible = useMemo(() => {
    const all = meetings ?? []
    if (filter.kind === 'trash') return all.filter((m) => Boolean(m.trashedAt))
    const live = all.filter((m) => !m.trashedAt)
    return filter.kind === 'folder' ? live.filter((m) => m.folderId === filter.id) : live
  }, [meetings, filter])

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = visible.filter((m) => {
      if (query.length === 0) return true
      // Instant title match keeps typing snappy; the async full-text hits
      // widen the net to notes and transcripts as they arrive.
      if ((m.title || 'New meeting').toLowerCase().includes(query)) return true
      return searchHits?.has(m.id) ?? false
    })
    const out: Array<{ label: string; items: MeetingSummary[]; older: boolean }> = []
    for (const m of filtered) {
      const label = dayLabel(m.createdAt)
      const last = out[out.length - 1]
      if (last && last.label === label) {
        last.items.push(m)
      } else {
        out.push({ label, items: [m], older: label !== 'Today' && label !== 'Yesterday' })
      }
    }
    return out
  }, [visible, search, searchHits])

  /* ---- mutations (upsert/delete, then let App refetch) ---- */

  const moveToTrash = (id: string): void => {
    setMenuFor(null)
    void window.meetings
      .upsert({ id, trashedAt: new Date().toISOString() })
      .then(() => onChanged())
      .catch(() => {})
  }

  const restore = (id: string): void => {
    void window.meetings
      .upsert({ id, trashedAt: null })
      .then(() => onChanged())
      .catch(() => {})
  }

  const deleteForever = (id: string): void => {
    if (!window.confirm('Delete this meeting forever? This cannot be undone.')) return
    void window.meetings
      .delete(id)
      .then(() => onChanged())
      .catch(() => {})
  }

  const emptyTrash = (): void => {
    const ids = (meetings ?? []).filter((m) => m.trashedAt).map((m) => m.id)
    if (ids.length === 0) return
    const what = ids.length === 1 ? 'the 1 meeting' : `all ${ids.length} meetings`
    if (!window.confirm(`Permanently delete ${what} in the trash? This cannot be undone.`)) return
    void Promise.all(ids.map((id) => window.meetings.delete(id)))
      .then(() => onChanged())
      .catch(() => {})
  }

  const assignFolder = (id: string, folderId: string | null): void => {
    setPickerFor(null)
    void window.meetings
      .upsert({ id, folderId })
      .then(() => onChanged())
      .catch(() => {})
  }

  /* ---- derived display bits ---- */

  const folderName =
    filter.kind === 'folder' ? (folders.find((f) => f.id === filter.id)?.name ?? 'Folder') : null
  const trashedCount = (meetings ?? []).filter((m) => m.trashedAt).length
  const isLoaded = meetings !== null
  const noneInView = isLoaded && visible.length === 0
  const noMatches = isLoaded && visible.length > 0 && groups.length === 0

  return (
    <div className={askVisible ? 'home has-ask' : 'home'}>
      <div className="home-topbar drag">
        {inTrash && trashedCount > 0 && (
          <button type="button" className="pill-btn pill-danger no-drag" onClick={emptyTrash}>
            Empty trash
          </button>
        )}
        <button
          type="button"
          className="pill-btn no-drag"
          title="Import a wav, mp3, or m4a recording — transcribed on-device into a regular meeting"
          disabled={importState === 'running'}
          onClick={() => void runImport()}
        >
          {importState === 'running' ? 'Importing…' : '⤓ Import audio'}
        </button>
        <button
          type="button"
          className="pill-btn new-note no-drag"
          title="A blank note — type freely, or hit record to mind-dump and generate notes"
          onClick={onNewNote}
        >
          + New note
        </button>
        <button type="button" className="pill-btn new-meeting no-drag" onClick={onNewMeeting}>
          + New meeting
        </button>
      </div>

      {shareNotice !== null && (
        <div className="share-notice" role="status">
          {shareNotice}
        </div>
      )}

      {importState !== 'idle' && importState !== 'running' && (
        <div className="toast" role="alert">
          <span>{importState}</span>
          <button type="button" onClick={() => setImportState('idle')}>
            ✕
          </button>
        </div>
      )}

      <div className="home-scroll">
        <div className="home-col">
          {filter.kind === 'all' && (
            // The "Coming up" heading + controls render inside (outside the
            // white card, above it) so paging state stays local.
            <ComingUpCard
              calendar={calendar}
              onStart={onStartCalendarMeeting}
              onOpenSettings={onOpenSettings}
            />
          )}
          {filter.kind === 'folder' && (
            <h2 className="home-heading">
              <FolderIcon size={17} /> {folderName}
            </h2>
          )}
          {inTrash && (
            <h2 className="home-heading">
              <TrashIcon size={17} /> Trash
            </h2>
          )}

          <div className={filter.kind === 'all' ? 'meetings-list' : 'meetings-list flush'}>
            {noneInView && filter.kind === 'all' && (
              <div className="home-empty">
                <span className="home-empty-mark">
                  <img src={mascotUrl} alt="" className="home-empty-mascot" />
                  <span className="home-empty-wordmark">
                    <span className="wm-doodle">Doodle</span>
                    <span className="wm-note">Note</span>
                  </span>
                </span>
                <p>No meetings yet — hit + New meeting</p>
              </div>
            )}
            {noneInView && filter.kind === 'folder' && (
              <div className="home-empty-line">No meetings in this folder yet</div>
            )}
            {noneInView && inTrash && <div className="home-empty-line">Trash is empty</div>}
            {noMatches && <div className="home-empty-line">No meetings match “{search}”</div>}
            {groups.map((group) => (
              <section key={group.label} className={group.older ? 'day-group older' : 'day-group'}>
                <div className="day-label">{group.label}</div>
                {group.items.map((m) => {
                  const menuOpen = menuFor === m.id
                  const pickerOpen = pickerFor === m.id
                  return (
                    <div
                      key={m.id}
                      role="button"
                      tabIndex={0}
                      className={
                        menuOpen || pickerOpen ? 'meeting-row actions-open' : 'meeting-row'
                      }
                      onClick={() => onOpenMeeting(m.id)}
                      onKeyDown={(e) => {
                        // Only the row itself — Enter on an inner button must
                        // not also open the meeting.
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onOpenMeeting(m.id)
                        }
                      }}
                    >
                      <span className="row-icon">
                        {m.kind === 'note' ? <PencilIcon size={14} /> : <DocIcon size={14} />}
                      </span>
                      <span className="row-main">
                        <span className="row-title">
                          {m.title.trim() || (m.kind === 'note' ? 'New note' : 'New meeting')}
                        </span>
                        <span className="row-sub">
                          {m.kind === 'note' ? 'Note' : 'Me'}
                          {m.durationMin !== undefined ? ` · ${m.durationMin} min` : ''}
                          {search.trim().length > 0 &&
                            (searchHits?.get(m.id) === 'transcript'
                              ? ' · matches transcript'
                              : searchHits?.get(m.id) === 'notes'
                                ? ' · matches notes'
                                : '')}
                        </span>
                      </span>
                      <span className="row-time">{timeLabel(m.createdAt)}</span>
                      {inTrash ? (
                        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="row-restore"
                            title="Move back to My notes"
                            onClick={() => restore(m.id)}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            className="row-delete"
                            title="Permanently delete this meeting"
                            onClick={() => deleteForever(m.id)}
                          >
                            Delete forever
                          </button>
                        </span>
                      ) : (
                        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="row-menu-btn"
                            title="More actions"
                            aria-label="More actions"
                            onClick={() => {
                              setPickerFor(null)
                              setMenuFor(menuOpen ? null : m.id)
                            }}
                          >
                            ⋯
                          </button>
                        </span>
                      )}
                      {menuOpen && (
                        <div className="row-menu" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            title="Copy a public link to this meeting's notes"
                            onClick={() => void copyShareLink(m.id)}
                          >
                            Copy share link
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFor(null)
                              setPickerFor(m.id)
                            }}
                          >
                            Add to folder
                          </button>
                          <button
                            type="button"
                            title="Notes + transcript as one portable Markdown file"
                            onClick={() => void exportMeeting(m.id, 'md')}
                          >
                            Export Markdown
                          </button>
                          <button
                            type="button"
                            title="Notes + transcript as a print-ready PDF"
                            onClick={() => void exportMeeting(m.id, 'pdf')}
                          >
                            Export PDF
                          </button>
                          <div className="row-menu-sep" />
                          <button
                            type="button"
                            className="danger"
                            onClick={() => moveToTrash(m.id)}
                          >
                            Move to trash
                          </button>
                        </div>
                      )}
                      {pickerOpen && (
                        <span onClick={(e) => e.stopPropagation()}>
                          <FolderPicker
                            align="right"
                            currentFolderId={m.folderId ?? null}
                            onAssign={(fid) => assignFolder(m.id, fid)}
                            onClose={() => setPickerFor(null)}
                          />
                        </span>
                      )}
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        </div>
      </div>

      {askVisible && chatOpen && (
        <div className="transcript-panel chat-panel">
          <div className="tp-head">
            <span className="tp-meta">Answers come from your recent meetings&rsquo; notes</span>
            <div className="tp-actions">
              {chatThread.length > 0 && askPending === null && (
                <button type="button" onClick={clearChat} title="Clear conversation">
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                title="Minimize"
                aria-label="Minimize chat"
              >
                —
              </button>
            </div>
          </div>
          <div className="tp-body chat-body" ref={chatFeedRef}>
            {chatThread.length === 0 && askPending === null && !askError ? (
              <div className="tp-empty">
                <p className="tp-empty-title">Ask anything</p>
                <p className="tp-empty-sub">Answers come from your recent meetings&rsquo; notes.</p>
              </div>
            ) : (
              <>
                {chatThread.map((entry, i) => (
                  <div key={`${entry.askedAt}-${i}`} className="chat-exchange">
                    <div className="chat-q">{entry.question}</div>
                    <div
                      className="chat-a"
                      // markdownToHtml escapes its input before adding tags.
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(entry.answer) }}
                    />
                    <div className="chat-actions">
                      <button
                        type="button"
                        title="Copy response"
                        onClick={() => {
                          void navigator.clipboard.writeText(entry.answer)
                          setChatCopied(i)
                          setTimeout(() => setChatCopied((v) => (v === i ? null : v)), 1500)
                        }}
                      >
                        {chatCopied === i ? '✓ Copied' : '⧉ Copy'}
                      </button>
                    </div>
                  </div>
                ))}
                {askPending !== null && (
                  <div className="chat-exchange">
                    <div className="chat-q">{askPending}</div>
                    {askStreamed.length > 0 ? (
                      <div
                        className="chat-a"
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(askStreamed) }}
                      />
                    ) : (
                      <div className="chat-a chat-thinking">
                        <span className="spinner" aria-hidden="true" />
                        Thinking…
                      </div>
                    )}
                  </div>
                )}
                {askError && (
                  <div className="chat-error" role="alert">
                    <span>{askError}</span>
                    {!modelReady && (
                      <button type="button" onClick={onOpenSettings}>
                        Open Settings →
                      </button>
                    )}
                    <button type="button" onClick={() => setAskError(null)}>
                      Dismiss
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {askVisible && (
        <form
          className="ask-bar home-ask-bar"
          onSubmit={(e) => {
            e.preventDefault()
            void submitAsk()
          }}
        >
          <input
            className="ask-input"
            type="text"
            spellCheck={false}
            placeholder={chatThread.length > 0 ? 'Continue chat' : 'Ask anything'}
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            onFocus={() => {
              // Surface the past conversation, but never open an empty panel.
              if (chatThread.length > 0 || askPending !== null) setChatOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (chatOpen) setChatOpen(false)
                else e.currentTarget.blur()
              }
            }}
          />
          {askPending !== null ? (
            <span className="spinner ask-spinner" aria-hidden="true" />
          ) : askText.trim().length > 0 ? (
            <button type="submit" className="ask-send" title="Ask" aria-label="Ask">
              ↑
            </button>
          ) : (
            <button
              type="button"
              className="ask-preset"
              onClick={() => void submitAsk(RECENT_TODOS_QUESTION)}
              title="List outstanding action items from your recent meetings"
            >
              <CheckSquareIcon size={13} /> List recent todos
            </button>
          )}
        </form>
      )}
    </div>
  )
}
