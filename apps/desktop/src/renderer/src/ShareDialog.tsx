import { useEffect, useRef, useState } from 'react'
import type {
  ShareFailure,
  ShareLinkExpiryDays,
  ShareRecipient,
  ShareSettingsUpdate,
  ShareState
} from '../../shared/sync-api'
import { Toggle } from './ModelsView'

/** Failures that make every action pointless until fixed elsewhere (Settings, billing). */
const BLOCKING: ReadonlyArray<ShareFailure['code']> = [
  'not_linked',
  'unauthorized',
  'needs_subscription',
  'unavailable',
  'local_only'
]

const EXPIRY_OPTIONS: ReadonlyArray<{ days: ShareLinkExpiryDays; label: string }> = [
  { days: 0, label: 'Never' },
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' }
]

type Notice = { text: string; error: boolean } | null

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/**
 * Share… dialog for one meeting, the same single panel as the web app:
 * Add people, Who has access (the workspace first, then each person), General
 * access (only people added, or anyone with the link with an optional
 * expiry), and one Include transcript setting for everyone. Every change
 * saves immediately through main (window.sync), which pushes the meeting
 * first when needed and maps cloud errors to guidance. The native modal
 * <dialog> traps focus and closes on Escape.
 */
export default function ShareDialog({
  meetingId,
  title,
  onClose,
  onOpenSettings
}: {
  meetingId: string
  title: string
  onClose(): void
  onOpenSettings(): void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [state, setState] = useState<ShareState | null>(null)
  const [blocked, setBlocked] = useState<ShareFailure | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [emails, setEmails] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  /** Expiry chosen in this session; null shows the saved date as-is. */
  const [expiryChoice, setExpiryChoice] = useState<ShareLinkExpiryDays | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.sync
      .shareState(meetingId)
      .then((result) => {
        if (cancelled) return
        if ('error' in result) {
          if (BLOCKING.includes(result.code)) setBlocked(result)
          else setLoadError(result.error)
          return
        }
        setState(result)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load sharing. Try again.')
      })
    return () => {
      cancelled = true
    }
  }, [meetingId])

  /** Blocking failures replace the dialog body with guidance; others show inline. */
  const fail = (result: ShareFailure, show: (text: string) => void): void => {
    if (BLOCKING.includes(result.code)) setBlocked(result)
    else show(result.error)
  }
  const showError = (text: string): void => setNotice({ text, error: true })

  const addPeople = async (): Promise<void> => {
    if (busy || emails.trim().length === 0) return
    setBusy('add')
    setNotice(null)
    setAddError(null)
    try {
      const result = await window.sync.addShareRecipients(meetingId, emails)
      if ('error' in result) return fail(result, setAddError)
      const before = new Set(state?.recipients.map((r) => r.id))
      const added = result.recipients.filter((r) => !before.has(r.id)).length
      // Adding pushes the meeting, so a cloud copy (and its workspace) now exists.
      const fresh = await window.sync.shareState(meetingId)
      setState((current) =>
        fresh && !('error' in fresh)
          ? fresh
          : current
            ? { ...current, recipients: result.recipients }
            : current
      )
      setEmails('')
      setNotice({
        text: `Shared with ${added} ${added === 1 ? 'person' : 'people'}. They'll get an email.`,
        error: false
      })
    } catch {
      setAddError('Could not share the meeting. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const removePerson = async (recipient: ShareRecipient): Promise<void> => {
    if (busy) return
    setBusy(`remove:${recipient.id}`)
    setNotice(null)
    try {
      const result = await window.sync.removeShareRecipient(meetingId, recipient.id)
      if ('error' in result) return fail(result, showError)
      setState((current) => (current ? { ...current, recipients: result.recipients } : current))
      setNotice({ text: `Removed ${recipient.email}.`, error: false })
    } catch {
      showError('Could not remove access. Try again.')
    } finally {
      setBusy(null)
    }
  }

  /** Saves one settings change and shows `done(next)` on success. */
  const save = async (
    key: string,
    update: ShareSettingsUpdate,
    done: (next: ShareState) => string
  ): Promise<void> => {
    if (busy) return
    setBusy(key)
    setNotice(null)
    try {
      const result = await window.sync.updateShareSettings(meetingId, update)
      if ('error' in result) return fail(result, showError)
      setState(result)
      setNotice({ text: done(result), error: false })
    } catch {
      showError('Could not save sharing. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const copyLink = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setNotice({ text: 'Link copied.', error: false })
    } catch {
      showError('Copy blocked — select the link to copy it.')
    }
  }

  const needsSettings = blocked?.code === 'not_linked' || blocked?.code === 'unauthorized'
  const link = state?.link ?? null
  const disabled = busy !== null
  const expiryValue = link?.expiresAt ? (expiryChoice ?? 'current') : '0'
  const workspace = state?.workspace ?? null

  return (
    <dialog
      ref={dialog}
      className="share-dialog"
      aria-labelledby="share-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="share-dialog-head">
        <h2 id="share-dialog-title">Share “{title}”</h2>
        <button type="button" className="share-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {blocked ? (
        <div className="share-blocked">
          <p role="alert">{blocked.error}</p>
          <div className="share-actions">
            {needsSettings && (
              <button
                type="button"
                className="share-primary"
                onClick={() => {
                  onClose()
                  onOpenSettings()
                }}
              >
                Open Settings
              </button>
            )}
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : loadError ? (
        <p className="share-msg error" role="alert">
          {loadError}
        </p>
      ) : !state ? (
        <p className="share-muted" role="status">
          Loading…
        </p>
      ) : (
        <>
          <form
            className="share-add"
            onSubmit={(event) => {
              event.preventDefault()
              void addPeople()
            }}
          >
            <label className="share-label" htmlFor="share-emails">
              Add people
            </label>
            <div className="share-add-row">
              <input
                id="share-emails"
                className="share-input"
                type="text"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                placeholder="name@example.com, …"
                value={emails}
                aria-invalid={addError ? true : undefined}
                aria-describedby={addError ? 'share-add-error' : 'share-add-help'}
                onChange={(event) => {
                  setEmails(event.target.value)
                  if (addError) setAddError(null)
                }}
              />
              <button
                type="submit"
                className="share-primary"
                disabled={disabled || emails.trim().length === 0}
              >
                {busy === 'add' ? 'Sharing…' : 'Share'}
              </button>
            </div>
            {addError ? (
              <p id="share-add-error" className="share-msg error" role="alert">
                {addError}
              </p>
            ) : (
              <span id="share-add-help" className="share-muted">
                Separate addresses with commas or spaces. People added can view, copy and export,
                but not edit.
              </span>
            )}
          </form>

          <section className="share-section" aria-labelledby="share-access-title">
            <h3 id="share-access-title">Who has access</h3>
            <ul className="share-recipients">
              <li>
                <span className="share-recipient-main">
                  {workspace && !workspace.personal ? (
                    <>
                      <span className="share-recipient-email">Everyone in {workspace.name}</span>
                      <span className="share-muted">
                        {workspace.memberCount} {workspace.memberCount === 1 ? 'member' : 'members'}{' '}
                        · Workspace
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="share-recipient-email">You · Owner</span>
                      <span className="share-muted">
                        {workspace ? 'Your Personal workspace' : 'Not in the cloud yet'}
                      </span>
                    </>
                  )}
                </span>
              </li>
              {state.recipients.map((recipient) => (
                <li key={recipient.id}>
                  <span className="share-recipient-main">
                    <span className="share-recipient-email" title={recipient.email}>
                      {recipient.email}
                    </span>
                    <span className="share-muted">Can view</span>
                  </span>
                  <button
                    type="button"
                    className="share-danger"
                    disabled={disabled}
                    aria-label={`Remove ${recipient.email}`}
                    onClick={() => void removePerson(recipient)}
                  >
                    {busy === `remove:${recipient.id}` ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="share-section" aria-labelledby="share-general-title">
            <h3 id="share-general-title">
              <label htmlFor="share-general">General access</label>
            </h3>
            <select
              id="share-general"
              className="share-input share-select"
              value={link ? 'link' : 'people'}
              disabled={disabled}
              onChange={(event) => {
                const on = event.target.value === 'link'
                setExpiryChoice(null)
                void save('access', { link: on ? 'on' : 'off' }, () =>
                  on ? 'Link is on. Anyone with it can view.' : 'Link turned off.'
                )
              }}
            >
              <option value="people">Only people added</option>
              <option value="link">Anyone with the link</option>
            </select>
            <span className="share-muted">
              {link
                ? 'Anyone on the internet with the link can view. No sign-in needed.'
                : workspace && !workspace.personal
                  ? `Only ${workspace.name} and people you add can open it.`
                  : 'Only you and people you add can open it.'}
            </span>
            {link && (
              <div className="share-link-box">
                <div className="share-add-row">
                  <input
                    className="share-input"
                    readOnly
                    value={link.url}
                    aria-label="Share link"
                    onFocus={(event) => event.target.select()}
                  />
                  <button type="button" onClick={() => void copyLink(link.url)}>
                    Copy link
                  </button>
                </div>
                <div className="share-expiry">
                  <label htmlFor="share-expiry">Link expires</label>
                  <select
                    id="share-expiry"
                    className="share-input"
                    value={expiryValue}
                    disabled={disabled}
                    onChange={(event) => {
                      if (event.target.value === 'current') return
                      const days = Number(event.target.value) as ShareLinkExpiryDays
                      void save('expiry', { expiresInDays: days }, (next) => {
                        setExpiryChoice(days)
                        return next.link?.expiresAt
                          ? `Link expires ${formatExpiry(next.link.expiresAt)}.`
                          : 'Link never expires.'
                      })
                    }}
                  >
                    {expiryValue === 'current' && <option value="current">On a set date</option>}
                    {EXPIRY_OPTIONS.map((option) => (
                      <option key={option.days} value={option.days}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="share-muted">
                    {link.expiresAt ? `Expires ${formatExpiry(link.expiresAt)}` : 'Never expires'}
                  </span>
                </div>
              </div>
            )}
          </section>

          <div className="share-section share-row">
            <span>
              <strong id="share-transcript-label">Include transcript</strong>
              <span className="share-muted">
                For everyone above{link ? ' and anyone with the link' : ''}. Off: people see the
                notes only.
              </span>
            </span>
            <Toggle
              checked={state.includeTranscript}
              disabled={disabled}
              onChange={() => {
                const includeTranscript = !state.includeTranscript
                void save('transcript', { includeTranscript }, () =>
                  includeTranscript
                    ? 'Transcript included for everyone.'
                    : 'Notes only for everyone.'
                )
              }}
              label="Include transcript for everyone"
            />
          </div>

          {notice && (
            <p
              className={notice.error ? 'share-msg error' : 'share-msg'}
              role={notice.error ? 'alert' : 'status'}
            >
              {notice.text}
            </p>
          )}
        </>
      )}
    </dialog>
  )
}
