import { useEffect, useRef, useState } from 'react'
import { flushLibrarySaves } from './lib/library-flush'
import type { StorageProgress, StorageResult, StorageStatus } from '../../shared/storage-api'

export function StorageSettings(): React.JSX.Element {
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState(false)
  const [progress, setProgress] = useState<StorageProgress>({ phase: 'waiting' })
  const modal = useRef<HTMLDialogElement>(null)
  useEffect(() => window.storage.onProgress(setProgress), [])
  useEffect(() => {
    if (moving) modal.current?.showModal()
    else modal.current?.close()
  }, [moving])
  const move = async (action: () => Promise<StorageResult>): Promise<void> => {
    setMoving(true)
    setProgress({ phase: 'waiting' })
    try {
      await run(async () => {
        try {
          await flushLibrarySaves()
        } catch {
          throw new Error(
            'Your latest edits could not be saved. The library was not moved. Try saving again before changing its location.'
          )
        }
        return action()
      })
    } finally {
      setMoving(false)
    }
  }

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
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'The storage action failed. Check folder access and try again.'
      )
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
              and verified now, without restarting DoodleNote. The original is kept as a recovery
              copy.
            </span>
          </span>
          <button
            type="button"
            className="pill-btn"
            disabled={busy || !status}
            onClick={() => void move(() => window.storage.choose())}
          >
            {busy ? 'Please wait…' : 'Choose folder…'}
          </button>
        </div>
        {status?.pendingPath && (
          <div className="cal-row" role="status">
            <span className="cal-row-main" style={{ minWidth: 0 }}>
              <span className="cal-row-label">Transfer needs attention</span>
              <span
                className="cal-row-sub"
                style={{ userSelect: 'text', overflowWrap: 'anywhere' }}
              >
                {status.pendingPath}
              </span>
              <span className="cal-row-sub">
                Your current library is still active. Reconnect the destination, then retry, or
                cancel this change.
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
            <button
              type="button"
              className="pill-btn"
              disabled={busy}
              onClick={() => void move(() => window.storage.retry())}
            >
              Retry transfer
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
      <dialog
        ref={modal}
        aria-label="Moving library"
        onCancel={(event) => event.preventDefault()}
        style={{ border: '1px solid #dedbd1', borderRadius: 16, padding: 28, maxWidth: 440 }}
      >
        <h3>Moving your library</h3>
        <p role="status">
          {progress.phase === 'copying'
            ? 'Copying your files…'
            : progress.phase === 'verifying'
              ? 'Checking your files…'
              : 'Finishing current saves…'}
        </p>
        {progress.phase === 'copying' && (
          <progress
            aria-label="Files copied"
            max={progress.totalBytes || 1}
            value={progress.completedBytes || 0}
            style={{ width: '100%' }}
          />
        )}
        <p>
          Keep both locations connected. You can continue working as soon as the transfer finishes.
        </p>
      </dialog>
      {error && (
        <p role="alert" className="models-sub">
          {error}
        </p>
      )}
    </section>
  )
}
