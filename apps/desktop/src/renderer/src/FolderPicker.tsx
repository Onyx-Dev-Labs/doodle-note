import { useEffect, useMemo, useRef, useState } from 'react'
import type { FolderRecord } from '../../shared/folders-api'
import type { MeetingSummary } from '../../shared/meetings-api'

/**
 * Granola-style "Add to folder" popover: search field, "My notes" + folder
 * rows with counts of non-trashed meetings, and an inline "New folder" row.
 * Shared by the Home-row ⋯ menu and the editor's folder chip. It fetches its
 * own data on open; the caller owns the actual assignment (upsert) via
 * onAssign(folderId), where null means "My notes" (unfiled).
 *
 * Render it inside a `position: relative` anchor — the popover is absolutely
 * positioned (left-aligned by default, `align="right"` for row usage).
 */
export default function FolderPicker({
  currentFolderId,
  align = 'left',
  onAssign,
  onClose
}: {
  currentFolderId: string | null
  align?: 'left' | 'right'
  onAssign: (folderId: string | null) => void
  onClose: () => void
}): React.JSX.Element {
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.folders
      .list()
      .then((list) => {
        if (!cancelled) setFolders(list)
      })
      .catch(() => {})
    void window.meetings
      .list()
      .then((list) => {
        if (!cancelled) setMeetings(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Close on outside click / Escape. mousedown fires before the opening
  // click completes, so the click that mounted the picker never re-closes it.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const counts = useMemo(() => {
    const perFolder = new Map<string, number>()
    let unfiled = 0
    for (const m of meetings) {
      if (m.trashedAt) continue
      if (m.folderId) perFolder.set(m.folderId, (perFolder.get(m.folderId) ?? 0) + 1)
      else unfiled += 1
    }
    return { perFolder, unfiled }
  }, [meetings])

  const q = query.trim().toLowerCase()
  const shownFolders = q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders
  const showMyNotes = q.length === 0 || 'my notes'.includes(q)

  const createAndAssign = async (): Promise<void> => {
    const name = newName.trim()
    if (name.length === 0) return
    try {
      const folder = await window.folders.create(name)
      onAssign(folder.id)
    } catch {
      onClose()
    }
  }

  return (
    <div
      ref={rootRef}
      className={align === 'right' ? 'folder-picker align-right' : 'folder-picker'}
      role="dialog"
      aria-label="Add to folder"
    >
      <input
        className="fp-search"
        type="text"
        placeholder="Search folders"
        spellCheck={false}
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="fp-list">
        {showMyNotes && (
          <button type="button" className="fp-row" onClick={() => onAssign(null)}>
            <span className="fp-icon">🔒</span>
            <span className="fp-name">My notes</span>
            {currentFolderId === null ? (
              <span className="fp-check">✓</span>
            ) : (
              <span className="fp-count">{counts.unfiled}</span>
            )}
          </button>
        )}
        {shownFolders.map((f) => (
          <button key={f.id} type="button" className="fp-row" onClick={() => onAssign(f.id)}>
            <span className="fp-icon">📁</span>
            <span className="fp-name">{f.name}</span>
            {currentFolderId === f.id ? (
              <span className="fp-check">✓</span>
            ) : (
              <span className="fp-count">{counts.perFolder.get(f.id) ?? 0}</span>
            )}
          </button>
        ))}
        {creating ? (
          <div className="fp-row fp-new-row">
            <span className="fp-icon fp-new-icon">＋</span>
            <input
              type="text"
              placeholder="Folder name"
              spellCheck={false}
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void createAndAssign()
                } else if (e.key === 'Escape') {
                  // Cancel just the inline creator, not the whole picker.
                  e.stopPropagation()
                  setCreating(false)
                  setNewName('')
                }
              }}
            />
          </div>
        ) : (
          <button type="button" className="fp-row fp-new" onClick={() => setCreating(true)}>
            <span className="fp-icon fp-new-icon">＋</span>
            <span className="fp-name">New folder</span>
          </button>
        )}
      </div>
    </div>
  )
}
