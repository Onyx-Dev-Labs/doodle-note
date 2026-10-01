import { useEffect, useState } from 'react'
import type { StorageResult, StorageStatus } from '../../shared/storage-api'

export function StorageSettings(): React.JSX.Element {
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.storage
      .status()
      .then((value) => {
        if (!cancelled) setStatus(value)
      })
      .catch(() => {
        if (!cancelled) setError('Could not read the library location. Reopen Settings to retry.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const run = async (action: () => Promise<StorageResult>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await action()
      if (result.status) setStatus(result.status)
      if (result.error) setError(result.error)
    } catch {
      setError('The storage action failed. Check folder access and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="keys-section" aria-label="Library storage">
      <h3>Library storage</h3>
      <p className="models-sub">
        Choose where your recordings, notes, transcripts and attachments are saved. App preferences,
        sign-ins and AI models stay in their current location.
      </p>
      <div className="cal-subcard">
        <div className="cal-row">
          <span className="cal-row-main" style={{ minWidth: 0 }}>
            <span className="cal-row-label">Current library folder</span>
            <span className="cal-row-sub" style={{ userSelect: 'text', overflowWrap: 'anywhere' }}>
              {status?.currentPath ?? 'Loading location…'}
            </span>
          </span>
          <button
            type="button"
            className="pill-btn"
            disabled={busy || !status}
            onClick={() => void run(() => window.storage.open())}
          >
            Open in Finder
          </button>
        </div>
        <div className="cal-row">
          <span className="cal-row-main">
            <span className="cal-row-label">Change location</span>
            <span className="cal-row-sub">
              Creates a DoodleNote Library folder at the location you choose. Your library is copied
              and verified when you next open DoodleNote. The original is kept as a recovery copy.
            </span>
          </span>
          <button
            type="button"
            className="pill-btn"
            disabled={busy || !status}
            onClick={() => void run(() => window.storage.choose())}
          >
            {busy ? 'Please wait…' : 'Choose folder…'}
          </button>
        </div>
        {status?.pendingPath && (
          <div className="cal-row" role="status">
            <span className="cal-row-main" style={{ minWidth: 0 }}>
              <span className="cal-row-label">Ready to transfer on next launch</span>
              <span
                className="cal-row-sub"
                style={{ userSelect: 'text', overflowWrap: 'anywhere' }}
              >
                {status.pendingPath}
              </span>
              <span className="cal-row-sub">
                Finish your work, quit DoodleNote, then reopen it with both locations available.
                Until then, new content stays in your current library.
              </span>
            </span>
            <button
              type="button"
              className="pill-btn"
              disabled={busy}
              onClick={() => void run(() => window.storage.cancel())}
            >
              Cancel change
            </button>
          </div>
        )}
        {status?.recoveryPath && (
          <div className="cal-row">
            <span className="cal-row-main" style={{ minWidth: 0 }}>
              <span className="cal-row-label">Original copy retained</span>
              <span
                className="cal-row-sub"
                style={{ userSelect: 'text', overflowWrap: 'anywhere' }}
              >
                {status.recoveryPath}
              </span>
              <span className="cal-row-sub">
                This copy is not updated with new changes. Keep it until you have checked the
                transferred library.
              </span>
            </span>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="models-sub">
          {error}
        </p>
      )}
    </section>
  )
}
