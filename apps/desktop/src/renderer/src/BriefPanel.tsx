import { useEffect, useId, useRef, useState } from 'react'
import type { EvidenceMeetingMeta } from '@repo/meetings-store/evidence-contract'
import type {
  BriefApi,
  BriefEdit,
  BriefForgetPreview,
  BriefPerson,
  BriefPreview,
  BriefView
} from '../../shared/briefs-api'
import type { CitationView } from '../../shared/cited-ask-api'
import { BriefController, type BriefControllerState } from './lib/brief-controller'
import CitedAnswer from './CitedAnswer'
import OriginalPassagePanel from './OriginalPassagePanel'
import './briefs.css'
import './cited-ask.css'
const date = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : 'Date unavailable'
const historicalDate = (m: EvidenceMeetingMeta): string =>
  m.occurredAt
    ? `${m.dateBasis === 'createdAt' ? 'Note created' : 'Meeting'} ${date(m.occurredAt)}`
    : 'Date unavailable'

export default function BriefPanel({
  eventId,
  onClose,
  onOpenSettings,
  api = window.briefs
}: {
  eventId: string
  onClose(): void
  onOpenSettings(): void
  api?: BriefApi
}): React.JSX.Element {
  const heading = useId()
  const modal = useRef<HTMLDialogElement>(null)
  const controller = useRef<BriefController | null>(null)
  const [state, setState] = useState<BriefControllerState>({ view: null, busy: true, error: null })
  const [citation, setCitation] = useState<{ id: string; view: CitationView } | null>(null)
  const [candidates, setCandidates] = useState<EvidenceMeetingMeta[] | null>(null)
  const [historyPreview, setHistoryPreview] = useState<BriefPreview | null>(null)
  const [forgetPreview, setForgetPreview] = useState<BriefForgetPreview | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [topicChanged, setTopicChanged] = useState(false)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('event')
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<'create-person' | 'create-company'>('create-person')
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = modal.current
    dialog?.showModal()
    let lastView: BriefView | null = null
    const c = new BriefController(api, (next) => {
      if (next.view !== lastView) {
        lastView = next.view
        setCitation(null)
        setCandidates(null)
        setHistoryPreview(null)
        setForgetPreview(null)
        setNotice(null)
      }
      setState(next)
    })
    controller.current = c
    void c.open(eventId)
    return () => {
      c.dispose()
      controller.current = null
      dialog?.close()
      previous?.focus()
    }
  }, [api, eventId])
  const v = state.view
  const command = (fn: (view: BriefView) => Promise<BriefView>): void => {
    void controller.current?.command(fn)
  }
  const read = async <T,>(
    fn: (view: BriefView) => Promise<T>,
    done: (value: T) => void
  ): Promise<void> => {
    try {
      const c = controller.current
      if (c) done(await c.read(fn))
    } catch {
      if (controller.current) setNotice('Context changed or is unavailable. Refresh and try again.')
    }
  }
  const edit = (change: BriefEdit): void =>
    command((view) => api.edit(view.sessionId, view.revision!, change))
  const select = (meetingIds: string[] | undefined, includeCompany = v?.includeCompany): void => {
    setTopicChanged(false)
    command((view) => api.select(view.sessionId, { meetingIds, includeCompany, topic }))
  }
  const generate = (): void => {
    setTopicChanged(false)
    command((view) =>
      api.generate(view.sessionId, crypto.randomUUID(), {
        meetingIds: view.selectedMeetingIds,
        includeCompany: view.includeCompany,
        topic
      })
    )
  }
  const openCitation = (id: string): Promise<void> =>
    read(
      (view) => api.citation(view.sessionId, id),
      (view) => setCitation({ id, view })
    )
  const people = v?.people ?? []
  const excluded = people.filter((p) => p.isSelf === true || p.roles.includes('resource'))
  const included = people.filter((p) => !excluded.includes(p))
  const person = (p: BriefPerson): React.JSX.Element => (
    <InviteeEditor
      key={`${v?.revision}:${p.id}`}
      person={p}
      view={v!}
      disabled={state.busy}
      edit={edit}
      preview={(personId) => {
        void read(
          (view) => api.previewHistory(view.sessionId, view.revision!, p.id, personId),
          setHistoryPreview
        )
      }}
    />
  )
  const busy = state.busy
  return (
    <dialog
      ref={modal}
      className="brief-panel no-drag"
      aria-labelledby={heading}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <header className="brief-header">
        <div>
          <span className="brief-eyebrow">On this device · Pre-meeting brief</span>
          <h2 id={heading}>{v?.event?.subject || 'Pre-meeting brief'}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close brief">
          Close
        </button>
      </header>
      <div className="brief-content">
        <p role="status" aria-live="polite">
          {state.error ||
            v?.message ||
            (busy ? `${v?.state ?? 'Checking'}…` : 'Review local context, then generate a brief.')}
        </p>
        {notice && <p role="alert">{notice}</p>}
        <div className="brief-actions">
          <button
            type="button"
            disabled={busy || !v}
            onClick={() => command((view) => api.refresh(view.sessionId))}
          >
            Refresh local context
          </button>
          {busy && v?.runId && (
            <button type="button" onClick={() => void controller.current?.cancel().catch(() => {})}>
              Cancel
            </button>
          )}
          {v && !v.event && !busy && (
            <button type="button" onClick={() => select([])}>
              Review with no selected history
            </button>
          )}
        </div>
        {v?.event && (
          <>
            <p>
              {date(v.event.startIso)} – {date(v.event.endIso)}
            </p>
            <p className="brief-meta">
              {v.event.provider === 'google' ? 'Google' : 'Microsoft'} · {v.event.sourceLabel}
              <br />
              Last calendar sync: {date(v.event.lastSyncIso)}
              {v.event.stale && ' · Cached calendar may be out of date'}
            </p>
            <section aria-label="People and company">
              <h3>People and company</h3>
              <p className="brief-meta">
                Calendar invitations do not establish attendance or who spoke. Matches apply only to
                this calendar account and local library.
              </p>
              {v.event.roster.state !== 'complete' && (
                <p role="status">
                  {v.event.roster.state === 'unknown'
                    ? 'Invitee list unavailable.'
                    : `Partial invitee list${v.event.roster.omittedCount === null ? '' : ` · ${v.event.roster.omittedCount} omitted`}.`}{' '}
                  You can link history for this event explicitly.
                </p>
              )}
              {included.map(person)}
              {excluded.length > 0 && (
                <details>
                  <summary>Self and resource entries ({excluded.length})</summary>
                  {excluded.map(person)}
                </details>
              )}
              <form
                className="brief-inline"
                onSubmit={(e) => {
                  e.preventDefault()
                  edit({ op: newKind, name: newName })
                  setNewName('')
                }}
              >
                <label>
                  Create local label
                  <select
                    value={newKind}
                    disabled={busy}
                    onChange={(e) => setNewKind(e.target.value as typeof newKind)}
                  >
                    <option value="create-person">Person</option>
                    <option value="create-company">Company</option>
                  </select>
                </label>
                <label>
                  Name
                  <input
                    value={newName}
                    maxLength={256}
                    disabled={busy}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
                <button disabled={busy || !newName.trim()}>Create</button>
              </form>
              <p className="brief-meta">
                Labels are chosen by you; companies are never inferred from an address.
              </p>
              {historyPreview && (
                <div
                  className="brief-confirm"
                  role="group"
                  aria-label="Confirm historical correction"
                >
                  <p>
                    Apply this exact identity correction to {historyPreview.count} previously
                    captured invitees in this account? {date(historyPreview.firstDate)} –{' '}
                    {date(historyPreview.lastDate)}. Original notes stay unchanged.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      command((view) => api.applyHistory(view.sessionId, historyPreview.previewId))
                    }
                  >
                    Apply to this history
                  </button>
                  <button onClick={() => setHistoryPreview(null)}>Keep occurrence only</button>
                </div>
              )}
            </section>
            <section aria-label="History used">
              <h3>History used</h3>
              <p>
                {v.selectedMeetingIds?.length ?? 0} selected · {v.historyTotal ?? 0} linked meetings
              </p>
              <label className="brief-check">
                <input
                  type="checkbox"
                  checked={v.includeCompany === true}
                  disabled={busy}
                  onChange={(e) => select(undefined, e.target.checked)}
                />
                Include explicitly linked company history for this brief
              </label>
              <div className="brief-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    select(v.history?.filter((m) => m.available).map((m) => m.meetingId) ?? [])
                  }
                >
                  Select shown available history
                </button>
                <button disabled={busy} onClick={() => select([])}>
                  Select none
                </button>
              </div>
              {(v.historyTotal ?? 0) > (v.history?.length ?? 0) && (
                <p>Showing up to 256 links. Narrow to shown meetings before generating.</p>
              )}
              {(v.selectedMeetingIds?.length ?? 0) > 256 && (
                <p role="alert">Select at most 256 meetings for one brief.</p>
              )}
              {!v.historyTotal && (
                <p>
                  No linked local history yet. Review the people above or link a prior meeting.
                  Today’s invitees are never used as proof of historical attendance.
                </p>
              )}
              {v.history?.map((m) => (
                <div className="brief-history" key={m.meetingId}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy || !m.available}
                      checked={v.selectedMeetingIds?.includes(m.meetingId) ?? false}
                      onChange={(e) =>
                        select(
                          e.target.checked
                            ? [...(v.selectedMeetingIds ?? []), m.meetingId]
                            : (v.selectedMeetingIds?.filter((id) => id !== m.meetingId) ?? [])
                        )
                      }
                    />
                    <span>
                      {m.title || 'Untitled meeting'}
                      <small>
                        {historicalDate(m)} · {m.provenance.join(', ')}
                      </small>
                    </span>
                  </label>
                  {m.linkIds.map((id, i) => (
                    <button
                      key={id}
                      disabled={busy}
                      onClick={() => edit({ op: 'unlink', linkId: id })}
                    >
                      Unlink{m.linkIds.length > 1 ? ` ${i + 1}` : ''}
                    </button>
                  ))}
                </div>
              ))}
              <details>
                <summary>Link a prior meeting</summary>
                <form
                  className="brief-inline"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void read((view) => api.candidates(view.sessionId, query), setCandidates)
                  }}
                >
                  <label>
                    Search local originals
                    <input
                      value={query}
                      maxLength={256}
                      disabled={busy}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <button disabled={busy}>Find meetings</button>
                </form>
                <label>
                  Link to
                  <select
                    disabled={busy}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="event">This event only</option>
                    {v.personChoices?.map((p) => (
                      <option value={`person:${p.id}`} key={p.id}>
                        Person: {p.name}
                      </option>
                    ))}
                    {v.companyChoices?.map((p) => (
                      <option value={`company:${p.id}`} key={p.id}>
                        Company: {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="brief-meta">
                  A meeting from another calendar connection can be linked to this event only. This
                  does not merge account identities.
                </p>
                {candidates?.length === 0 && (
                  <p>No eligible local originals found for this search.</p>
                )}
                {candidates?.map((m) => (
                  <div className="brief-history" key={m.meetingId}>
                    <span>
                      {m.title}
                      <small>{historicalDate(m)}</small>
                    </span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        command((view) =>
                          api.link(
                            view.sessionId,
                            view.revision!,
                            m.meetingId,
                            target.startsWith('person:')
                              ? { kind: 'person', personId: target.slice(7) }
                              : target.startsWith('company:')
                                ? { kind: 'company', companyId: target.slice(8) }
                                : { kind: 'event' }
                          )
                        )
                      }
                    >
                      Link meeting
                    </button>
                  </div>
                ))}
              </details>
            </section>
            <section aria-label="Brief">
              <h3>Prior decisions and commitments</h3>
              <label>
                Optional focus
                <input
                  value={topic}
                  disabled={busy}
                  maxLength={1024}
                  onChange={(e) => {
                    setTopic(e.target.value)
                    setTopicChanged(true)
                    setCitation(null)
                  }}
                  placeholder="For example, proposal review"
                />
              </label>
              <div className="brief-actions">
                <button
                  className="brief-primary"
                  disabled={busy || (v.selectedMeetingIds?.length ?? 0) > 256}
                  onClick={generate}
                >
                  Generate brief
                </button>
                {v.errorCode?.startsWith('model-') && (
                  <button onClick={onOpenSettings}>Local model settings</button>
                )}
              </div>
              <p className="brief-meta">
                Generation runs locally only after you choose Generate. Historical commitments do
                not establish that work is still outstanding. Generated briefs remain in memory.
              </p>
              {!topicChanged && v.result && (
                <CitedAnswer snapshot={v.result.snapshot} onOpenCitation={openCitation} />
              )}
            </section>
            <details>
              <summary>Saved context and privacy</summary>
              <p>
                Names, observed addresses and correction history are stored as plaintext in your
                local library and move with it. Disconnecting a calendar preserves that context.
                Forget removes known context for this account; meetings, recordings and credentials
                are unchanged.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void read((view) => api.previewForget(view.sessionId), setForgetPreview)
                }
              >
                Preview forgetting this account’s context
              </button>
              {forgetPreview && (
                <div className="brief-confirm">
                  <p>
                    Forget {forgetPreview.snapshots} observations, {forgetPreview.people} people,{' '}
                    {forgetPreview.companies} companies and {forgetPreview.changes} corrections?
                    Reopening an event can capture a new observation.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      command((view) =>
                        api.forget(view.sessionId, forgetPreview.previewId, forgetPreview.revision)
                      )
                    }
                  >
                    Forget saved context
                  </button>
                  <button onClick={() => setForgetPreview(null)}>Keep context</button>
                </div>
              )}
            </details>
          </>
        )}
      </div>
      <OriginalPassagePanel
        view={citation?.view ?? null}
        onClose={() => setCitation(null)}
        onPlayAudio={
          citation
            ? async (token) => {
                const c = controller.current
                if (!c) throw new Error('Brief closed.')
                return c.read((view) => api.play(view.sessionId, citation.id, token))
              }
            : undefined
        }
      />
    </dialog>
  )
}

function InviteeEditor({
  person: p,
  view,
  disabled,
  edit,
  preview
}: {
  person: BriefPerson
  view: BriefView
  disabled: boolean
  edit(change: BriefEdit): void
  preview(personId: string | null): void
}): React.JSX.Element {
  const [selected, setSelected] = useState(p.personId ?? '')
  const [future, setFuture] = useState(false)
  const [rename, setRename] = useState(p.personName ?? '')
  return (
    <article className="brief-person">
      <strong>{p.displayName || p.address || 'Unidentified invitee'}</strong>
      <p className="brief-meta">
        Invited · {p.roles.join(', ')}
        {p.address && ` · ${p.address}`}
        <br />
        {p.provenance === 'user'
          ? 'Corrected by you'
          : p.provenance === 'confirmed-rule'
            ? 'Your confirmed exact identity rule'
            : 'Unassigned'}{' '}
        ·{' '}
        {p.isSelf === null
          ? 'Self identity unknown'
          : p.isSelf
            ? 'Marked as you'
            : 'Marked as someone else'}
      </p>
      {p.personName && (
        <p>
          Local person: {p.personName}
          {p.companyName && ` · ${p.companyName}`}
        </p>
      )}
      <details>
        <summary>Review or correct</summary>
        {!p.roles.includes('resource') && (
          <>
            <label>
              Choose person
              <select
                value={selected}
                disabled={disabled}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Leave unassigned</option>
                {view.personChoices?.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="brief-check">
              <input
                type="checkbox"
                checked={future}
                disabled={disabled || !p.identifierKey}
                onChange={(e) => setFuture(e.target.checked)}
              />
              Use this exact calendar identity for future events in this account
            </label>
            <div className="brief-actions">
              <button
                disabled={disabled}
                onClick={() =>
                  edit({ op: 'bind', inviteeId: p.id, personId: selected || null, future })
                }
              >
                Save match
              </button>
              {p.personId && (
                <button
                  disabled={disabled || !p.identifierKey}
                  onClick={() => edit({ op: 'exclude', inviteeId: p.id, personId: p.personId! })}
                >
                  Not this person
                </button>
              )}
              <button
                disabled={disabled || !p.identifierKey}
                onClick={() => preview(selected || null)}
              >
                Preview same-identity history correction
              </button>
            </div>
            {p.personId && (
              <>
                <label>
                  Optional company
                  <select
                    value={p.companyId ?? ''}
                    disabled={disabled}
                    onChange={(e) =>
                      edit({
                        op: 'company',
                        personId: p.personId!,
                        companyId: e.target.value || null
                      })
                    }
                  >
                    <option value="">No company</option>
                    {view.companyChoices?.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </label>
                <form
                  className="brief-inline"
                  onSubmit={(e) => {
                    e.preventDefault()
                    edit({ op: 'rename', entity: 'person', id: p.personId!, name: rename })
                  }}
                >
                  <label>
                    Rename local person
                    <input
                      value={rename}
                      maxLength={256}
                      disabled={disabled}
                      onChange={(e) => setRename(e.target.value)}
                    />
                  </label>
                  <button disabled={disabled || !rename.trim()}>Rename</button>
                </form>
              </>
            )}
          </>
        )}
        <div className="brief-actions">
          <button
            disabled={disabled || p.roles.includes('resource')}
            onClick={() => edit({ op: 'self', inviteeId: p.id, isSelf: true })}
          >
            This is me
          </button>
          <button
            disabled={disabled || p.roles.includes('resource')}
            onClick={() => edit({ op: 'self', inviteeId: p.id, isSelf: false })}
          >
            This is someone else
          </button>
        </div>
      </details>
    </article>
  )
}
