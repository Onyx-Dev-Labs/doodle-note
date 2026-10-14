import { useEffect, useRef, useState } from 'react'
import type {
  PublicLink,
  PublicLinkExpiryDays,
  ShareFailure,
  ShareRecipient
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

const EXPIRY_OPTIONS: ReadonlyArray<{ days: PublicLinkExpiryDays; label: string }> = [
  { days: 1, label: 'After 24 hours' },
  { days: 7, label: 'After 7 days' },
  { days: 30, label: 'After 30 days' },
  { days: 0, label: 'Never' }
]

type Notice = { text: string; error: boolean } | null

function expiryLabel(link: PublicLink): string {
  if (!link.expiresAt) return 'Does not expire'
  const at = new Date(link.expiresAt)
  return at.getTime() <= Date.now()
    ? `Expired ${at.toLocaleString()} — update it to share again`
    : `Expires ${at.toLocaleString()}`
}

/**
 * Share… dialog for one meeting: give specific people read-only access in
 * their own DoodleNote account, and manage the public link. Every action
 * goes through main (window.sync), which pushes the meeting first when
 * needed and maps cloud errors to guidance.
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
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState<ShareFailure | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [recipients, setRecipients] = useState<ShareRecipient[]>([])
  const [emails, setEmails] = useState('')
  const [peopleTranscript, setPeopleTranscript] = useState(true)
  const [peopleBusy, setPeopleBusy] = useState(false)
  const [peopleNotice, setPeopleNotice] = useState<Notice>(null)

  const [link, setLink] = useState<PublicLink | null>(null)
  const [linkTranscript, setLinkTranscript] = useState(false)
  const [expiry, setExpiry] = useState<PublicLinkExpiryDays>(7)
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkNotice, setLinkNotice] = useState<Notice>(null)

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
        setRecipients(result.recipients)
        setLink(result.link)
        if (result.link) {
          setLinkTranscript(result.link.includeTranscript)
          setExpiry(result.link.expiresAt ? 7 : 0)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load sharing. Try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [meetingId])

  /** Blocking failures replace the dialog body with guidance; others stay inline. */
  const fail = (result: ShareFailure, show: (notice: Notice) => void): void => {
    if (BLOCKING.includes(result.code)) setBlocked(result)
    else show({ text: result.error, error: true })
  }

  const share = async (): Promise<void> => {
    if (peopleBusy || emails.trim().length === 0) return
    setPeopleBusy(true)
    setPeopleNotice(null)
    try {
      const result = await window.sync.addShareRecipients(meetingId, emails, peopleTranscript)
      if ('error' in result) return fail(result, setPeopleNotice)
      const before = new Set(recipients.map((r) => r.id))
      const added = result.recipients.filter((r) => !before.has(r.id)).length
      setRecipients(result.recipients)
      setEmails('')
      setPeopleNotice({
        text: `Shared with ${added} ${added === 1 ? 'person' : 'people'}. They'll get an email.`,
        error: false
      })
    } catch {
      setPeopleNotice({ text: 'Could not share the meeting. Try again.', error: true })
    } finally {
      setPeopleBusy(false)
    }
  }

  const remove = async (recipient: ShareRecipient): Promise<void> => {
    if (peopleBusy) return
    setPeopleBusy(true)
    setPeopleNotice(null)
    try {
      const result = await window.sync.removeShareRecipient(meetingId, recipient.id)
      if ('error' in result) return fail(result, setPeopleNotice)
      setRecipients(result.recipients)
      setPeopleNotice({ text: `Removed ${recipient.email}.`, error: false })
    } catch {
      setPeopleNotice({ text: 'Could not remove access. Try again.', error: true })
    } finally {
      setPeopleBusy(false)
    }
  }

  const copy = async (url: string, done: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setLinkNotice({ text: done, error: false })
    } catch {
      setLinkNotice({ text: 'Copy blocked — select the link above to copy it.', error: true })
    }
  }

  const saveLink = async (): Promise<void> => {
    if (linkBusy) return
    setLinkBusy(true)
    setLinkNotice(null)
    try {
      const existed = link !== null
      const result = await window.sync.setPublicLink(meetingId, {
        includeTranscript: linkTranscript,
        expiresInDays: expiry
      })
      if ('error' in result) return fail(result, setLinkNotice)
      setLink(result.link)
      if (result.link) {
        await copy(
          result.link.url,
          existed ? 'Link updated and copied.' : 'Link created and copied.'
        )
      }
    } catch {
      setLinkNotice({ text: 'Could not save the link. Try again.', error: true })
    } finally {
      setLinkBusy(false)
    }
  }

  const revoke = async (): Promise<void> => {
    if (linkBusy) return
    setLinkBusy(true)
    setLinkNotice(null)
    try {
      const result = await window.sync.revokePublicLink(meetingId)
      if ('error' in result) return fail(result, setLinkNotice)
      setLink(null)
      setLinkNotice({ text: 'Link revoked. It no longer opens.', error: false })
    } catch {
      setLinkNotice({ text: 'Could not revoke the link. Try again.', error: true })
    } finally {
      setLinkBusy(false)
    }
  }

  const needsSettings = blocked?.code === 'not_linked' || blocked?.code === 'unauthorized'

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
      ) : loading ? (
        <p className="share-muted" role="status">
          Loading…
        </p>
      ) : (
        <>
          {loadError && (
            <p className="share-msg error" role="alert">
              {loadError}
            </p>
          )}

          <section className="share-section" aria-labelledby="share-people-title">
            <h3 id="share-people-title">Share with people</h3>
            <p className="share-muted">
              People you add can read this meeting in their own DoodleNote account. They can copy
              and export it, but can’t edit or reshare it.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void share()
              }}
            >
              <label className="share-label" htmlFor="share-emails">
                Email addresses
              </label>
              <textarea
                id="share-emails"
                className="share-input"
                rows={2}
                spellCheck={false}
                placeholder="name@example.com, teammate@example.com"
                value={emails}
                aria-invalid={peopleNotice?.error === true}
                aria-describedby={peopleNotice ? 'share-people-notice' : undefined}
                onChange={(event) => setEmails(event.target.value)}
                onKeyDown={(event) => {
                  // Enter shares; Shift+Enter keeps a newline for pasted lists.
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void share()
                  }
                }}
              />
              <div className="share-row">
                <span>
                  <strong>Include transcript</strong>
                  <span className="share-muted">Turn off to share only the notes.</span>
                </span>
                <Toggle
                  checked={peopleTranscript}
                  onChange={() => setPeopleTranscript((v) => !v)}
                  label="Include transcript for people you add"
                />
              </div>
              <div className="share-actions">
                <button
                  type="submit"
                  className="share-primary"
                  disabled={peopleBusy || emails.trim().length === 0}
                >
                  {peopleBusy ? 'Saving…' : 'Share'}
                </button>
              </div>
            </form>
            {peopleNotice && (
              <p
                id="share-people-notice"
                className={peopleNotice.error ? 'share-msg error' : 'share-msg'}
                role={peopleNotice.error ? 'alert' : 'status'}
              >
                {peopleNotice.text}
              </p>
            )}
            <p className="share-label">People with access</p>
            {recipients.length === 0 ? (
              <p className="share-muted">Only people in this workspace can see this meeting.</p>
            ) : (
              <ul className="share-recipients">
                {recipients.map((recipient) => (
                  <li key={recipient.id}>
                    <span className="share-recipient-main">
                      <span className="share-recipient-email">{recipient.email}</span>
                      <span className="share-muted">
                        Can view ·{' '}
                        {recipient.includeTranscript ? 'Notes and transcript' : 'Notes only'}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="share-danger"
                      disabled={peopleBusy}
                      aria-label={`Remove ${recipient.email}`}
                      onClick={() => void remove(recipient)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="share-section" aria-labelledby="share-link-title">
            <h3 id="share-link-title">Public link</h3>
            <p className="share-muted">
              Anyone with the link can read the selected content until you revoke it or it expires.
            </p>
            <div className="share-row">
              <span>
                <strong>Include transcript</strong>
                <span className="share-muted">
                  Off by default so sharing notes does not expose the full conversation.
                </span>
              </span>
              <Toggle
                checked={linkTranscript}
                onChange={() => setLinkTranscript((v) => !v)}
                label="Include transcript in the public link"
              />
            </div>
            <div className="share-row">
              <label htmlFor="share-expiry">
                <strong>Link expires</strong>
              </label>
              <select
                id="share-expiry"
                className="share-input"
                value={expiry}
                onChange={(event) => setExpiry(Number(event.target.value) as PublicLinkExpiryDays)}
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.days} value={option.days}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {link && (
              <div className="share-link-box">
                <span className="share-link-url">{link.url}</span>
                <span className="share-muted">
                  {expiryLabel(link)} ·{' '}
                  {link.includeTranscript ? 'Notes and transcript' : 'Notes only'}
                </span>
              </div>
            )}
            <div className="share-actions">
              <button
                type="button"
                className="share-primary"
                disabled={linkBusy}
                onClick={() => void saveLink()}
              >
                {linkBusy ? 'Saving…' : link ? 'Update link' : 'Create link'}
              </button>
              {link && (
                <button type="button" onClick={() => void copy(link.url, 'Link copied.')}>
                  Copy link
                </button>
              )}
              {link && (
                <button
                  type="button"
                  className="share-danger"
                  disabled={linkBusy}
                  onClick={() => void revoke()}
                >
                  Revoke
                </button>
              )}
            </div>
            {linkNotice && (
              <p
                className={linkNotice.error ? 'share-msg error' : 'share-msg'}
                role={linkNotice.error ? 'alert' : 'status'}
              >
                {linkNotice.text}
              </p>
            )}
          </section>
        </>
      )}
    </dialog>
  )
}
