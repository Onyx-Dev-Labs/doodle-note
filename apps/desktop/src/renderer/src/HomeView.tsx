import { useEffect, useMemo, useState } from 'react'
import type { FolderRecord } from '../../shared/folders-api'
import type { MeetingSummary } from '../../shared/meetings-api'
import FolderPicker from './FolderPicker'
import logoUrl from './assets/doodlenote-logo.png'

/** Which meetings the Home list shows; lives in App next to `search`. */
export type HomeFilter = { kind: 'all' } | { kind: 'trash' } | { kind: 'folder'; id: string }

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
 *  to everything / one folder / the trash. Data is owned by App; mutations
 *  here upsert/delete and then ask App to refetch via onChanged. */
export default function HomeView({
  meetings,
  folders,
  filter,
  search,
  onOpenMeeting,
  onNewMeeting,
  onChanged
}: {
  meetings: MeetingSummary[] | null
  folders: FolderRecord[]
  filter: HomeFilter
  search: string
  onOpenMeeting: (id: string) => void
  onNewMeeting: () => void
  onChanged: () => void
}): React.JSX.Element {
  /** Meeting id whose ⋯ menu is open, and whose folder picker is open. */
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  const inTrash = filter.kind === 'trash'

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
    <div className="home">
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
    </div>
  )
}
