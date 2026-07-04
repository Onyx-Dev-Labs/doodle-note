import { useEffect, useMemo, useState } from 'react'
import type { MeetingSummary } from '../../shared/meetings-api'
import logoUrl from './assets/doodlenote-logo.png'

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

/** Home: "Coming up" calendar slot + the day-grouped meetings list. */
export default function HomeView({
  active,
  refreshToken,
  search,
  onOpenMeeting,
  onNewMeeting
}: {
  active: boolean
  refreshToken: number
  search: string
  onOpenMeeting: (id: string) => void
  onNewMeeting: () => void
}): React.JSX.Element {
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void window.meetings
      .list()
      .then((list) => {
        if (!cancelled) setMeetings(list)
      })
      .catch(() => {
        if (!cancelled) setMeetings([])
      })
    return () => {
      cancelled = true
    }
  }, [active, refreshToken])

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = (meetings ?? []).filter(
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
  }, [meetings, search])

  const isEmpty = meetings !== null && meetings.length === 0
  const noMatches = meetings !== null && meetings.length > 0 && groups.length === 0

  return (
    <div className="home">
      <div className="home-topbar drag">
        <button type="button" className="pill-btn new-meeting no-drag" onClick={onNewMeeting}>
          + New meeting
        </button>
      </div>

      <div className="home-scroll">
        <div className="home-col">
          <h2 className="home-heading">Coming up</h2>
          <div className="card coming-up">
            <div className="coming-up-empty">Connect your calendar — coming soon</div>
          </div>

          <div className="meetings-list">
            {isEmpty && (
              <div className="home-empty">
                <img src={logoUrl} alt="DoodleNote" className="home-empty-logo" />
                <p>No meetings yet — hit + New meeting</p>
              </div>
            )}
            {noMatches && <div className="home-empty-line">No meetings match “{search}”</div>}
            {groups.map((group) => (
              <section key={group.label} className={group.older ? 'day-group older' : 'day-group'}>
                <div className="day-label">{group.label}</div>
                {group.items.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className="meeting-row"
                    onClick={() => onOpenMeeting(m.id)}
                  >
                    <span className="row-icon">☰</span>
                    <span className="row-main">
                      <span className="row-title">{m.title.trim() || 'New meeting'}</span>
                      <span className="row-sub">
                        Me{m.durationMin !== undefined ? ` · ${m.durationMin} min` : ''}
                      </span>
                    </span>
                    <span className="row-time">{timeLabel(m.createdAt)}</span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
