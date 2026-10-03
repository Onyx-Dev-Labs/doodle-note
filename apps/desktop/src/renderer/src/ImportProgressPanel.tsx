import { useEffect, useState } from 'react'
import type { ImportProgress } from '../../shared/import-api'
import { importProgressText, isImportActive, newerImportState } from './lib/import-progress'

/** Mounted above navigation so leaving Home never hides a running import. */
export function ImportProgressPanel({
  onOpen
}: {
  onOpen: (id: string) => void
}): React.JSX.Element | null {
  const [job, setJob] = useState<ImportProgress | null>(null)
  const [hiddenJob, setHiddenJob] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const update = (next: ImportProgress | null): void => {
      if (alive) setJob((current) => newerImportState(current, next))
    }
    const unsubscribe = window.importer.onProgress(update)
    void window.importer
      .getStatus()
      .then(update)
      .catch(() => {})
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  if (!job || hiddenJob === job.jobId) return null
  const active = isImportActive(job)
  const act = async (action: 'cancel' | 'retry'): Promise<void> => {
    setActionError(null)
    try {
      if (action === 'cancel') {
        const next = await window.importer.cancel(job.jobId)
        setJob((current) => newerImportState(current, next))
      } else {
        const result = await window.importer.retry(job.jobId)
        if (result.error) setActionError(result.error)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <section className="import-progress-panel no-drag" aria-label="Audio import progress">
      <div className="import-progress-heading">
        <strong role="status" aria-live="polite">
          {importProgressText(job)}
        </strong>
        {active ? (
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
            {collapsed ? 'Show details' : 'Hide details'}
          </button>
        ) : (
          <button type="button" onClick={() => setHiddenJob(job.jobId)}>
            Dismiss
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          <p className="import-progress-label">{job.label}</p>
          {job.stage === 'downloading_model' ? (
            <>
              <p>Downloading the speech model. Your recording stays on this computer.</p>
              {typeof job.progress === 'number' && (
                <progress value={job.progress} max={1} aria-label="Model download" />
              )}
            </>
          ) : (
            active && (
              <p>
                {job.stage === 'canceling'
                  ? 'Waiting for the import to stop safely…'
                  : 'Processing on this computer. You can keep using DoodleNote.'}
              </p>
            )
          )}
          {job.parts && (
            <p>
              Recording part {job.part} of {job.parts}
            </p>
          )}
          {(job.error || actionError) && <p role="alert">{actionError ?? job.error}</p>}
        </>
      )}
      <div className="import-progress-actions">
        {active && (
          <button
            type="button"
            disabled={job.stage === 'canceling' || job.stage === 'finishing'}
            onClick={() => void act('cancel')}
          >
            Cancel import
          </button>
        )}
        {(job.stage === 'failed' || job.stage === 'canceled') && (
          <button type="button" onClick={() => void act('retry')}>
            Retry
          </button>
        )}
        {job.stage === 'completed' && (
          <button type="button" onClick={() => onOpen(job.meetingId)}>
            Open transcript
          </button>
        )}
      </div>
    </section>
  )
}
