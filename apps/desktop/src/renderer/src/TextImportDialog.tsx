import { useEffect, useRef, useState } from 'react'
import type { TextImportPreview } from '../../shared/text-import-api'

export default function TextImportDialog({
  preview,
  onClose,
  onImported
}: {
  preview: TextImportPreview
  onClose(): void
  onImported(id: string): void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const cancel = (): void => {
    if (saving) return
    void window.textImporter.cancel(preview.token)
    onClose()
  }
  const commit = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await window.textImporter.commit(preview.token)
      if (result.meetingId) {
        onImported(result.meetingId)
        onClose()
      } else setError(result.error ?? 'Could not import this transcript.')
    } catch {
      setError('Could not save this transcript. Please try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="text-import-dialog"
      aria-labelledby="text-import-title"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
    >
      <h2 id="text-import-title">Import transcript</h2>
      <p>
        <strong>{preview.fileName}</strong>
      </p>
      <p>
        A new note will contain this transcript. Speaker labels are retained when recognized. No
        recording or timestamps are added.
      </p>
      <p className="text-import-local">
        Text imports stay on this computer and support search, notes generation and export. Cloud
        sync and share links are not available for these notes.
      </p>
      <div className="text-import-preview" aria-label="Transcript preview" tabIndex={0}>
        {preview.segments.map((segment) => (
          <section key={segment.id}>
            <strong>{segment.speaker}</strong>
            <p>{segment.text}</p>
          </section>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="text-import-actions">
        <button type="button" onClick={cancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" onClick={() => void commit()} disabled={saving}>
          {saving ? 'Saving…' : 'Import transcript'}
        </button>
      </div>
    </dialog>
  )
}
