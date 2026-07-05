import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FolderRecord } from '../../shared/folders-api'
import type { MeetingSummary } from '../../shared/meetings-api'
import type {
  GlobalChatEntry,
  NotesModelsResponse,
  NotesSettingsView
} from '../../shared/notes-api'
import FolderPicker from './FolderPicker'
import { markdownToHtml } from './lib/markdown'
import logoUrl from './assets/doodlenote-logo.png'

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

/** Home: "Coming up" calendar slot + the day-grouped meetings list, filtered
 *  to everything / one folder / the trash, plus the cross-meeting "Ask
 *  anything" bar and chat panel. Data is owned by App; mutations here
 *  upsert/delete and then ask App to refetch via onChanged. */
export default function HomeView({
  meetings,
  folders,
  filter,
  search,
  onOpenMeeting,
  onNewMeeting,
  onChanged,
  onOpenSettings
}: {
  meetings: MeetingSummary[] | null
  folders: FolderRecord[]
  filter: HomeFilter
  search: string
  onOpenMeeting: (id: string) => void
  onNewMeeting: () => void
  onChanged: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  /** Meeting id whose ⋯ menu is open, and whose folder picker is open. */
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)

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

  const visible = useMemo(() => {
    const all = meetings ?? []
    if (filter.kind === 'trash') return all.filter((m) => Boolean(m.trashedAt))
    const live = all.filter((m) => !m.trashedAt)
    return filter.kind === 'folder' ? live.filter((m) => m.folderId === filter.id) : live
  }, [meetings, filter])

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = visible.filter(
      (m) => query.length === 0 || (m.title || 'New meeting').toLowerCase().includes(query)
    )
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
  }, [visible, search])

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
        <button type="button" className="pill-btn new-meeting no-drag" onClick={onNewMeeting}>
          + New meeting
        </button>
      </div>

      <div className="home-scroll">
        <div className="home-col">
          {filter.kind === 'all' && (
            <>
              <h2 className="home-heading">Coming up</h2>
              <div className="card coming-up">
                <div className="coming-up-empty">Connect your calendar — coming soon</div>
              </div>
            </>
          )}
          {filter.kind === 'folder' && <h2 className="home-heading">📁 {folderName}</h2>}
          {inTrash && <h2 className="home-heading">🗑 Trash</h2>}

          <div className={filter.kind === 'all' ? 'meetings-list' : 'meetings-list flush'}>
            {noneInView && filter.kind === 'all' && (
              <div className="home-empty">
                <img src={logoUrl} alt="DoodleNote" className="home-empty-logo" />
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
                      <span className="row-icon">☰</span>
                      <span className="row-main">
                        <span className="row-title">{m.title.trim() || 'New meeting'}</span>
                        <span className="row-sub">
                          Me{m.durationMin !== undefined ? ` · ${m.durationMin} min` : ''}
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
                          <button type="button" disabled title="Coming with cloud sync">
                            Copy link
                          </button>
                          <button type="button" disabled title="Coming with cloud sync">
                            Share
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
              ☑ List recent todos
            </button>
          )}
        </form>
      )}
    </div>
  )
}
