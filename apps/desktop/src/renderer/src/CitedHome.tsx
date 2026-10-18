import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderRecord } from '../../shared/folders-api'
import type { EvidenceFilters, CensusResult } from '@repo/meetings-store/evidence-contract'
import type { AskProgress, CitationView } from '../../shared/cited-ask-api'
import type { HomeCitedEntry, HomeCitedResult } from '../../shared/home-cited-api'
import CitedAnswer from './CitedAnswer'
import OriginalPassagePanel from './OriginalPassagePanel'
const PAST_MENTIONS =
  'Find past action-item mentions and their dated commitments. Do not assume they remain outstanding.'

export default function CitedHome({
  folders,
  onOpenSettings
}: {
  folders: FolderRecord[]
  onOpenSettings(): void
}): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const [folder, setFolder] = useState('')
  const [from, setFrom] = useState('')
  const [before, setBefore] = useState('')
  const [entries, setEntries] = useState<HomeCitedEntry[]>([])
  const [checking, setChecking] = useState(true)
  const [phase, setPhase] = useState<AskProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsModel, setNeedsModel] = useState(false)
  const [unsaved, setUnsaved] = useState<Exclude<HomeCitedResult, { status: 'error' }> | null>(null)
  const [source, setSource] = useState<{
    entryId: string
    evidenceId: string
    view: CitationView
  } | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [literal, setLiteral] = useState('')
  const [counting, setCounting] = useState(false)
  const [census, setCensus] = useState<CensusResult | null>(null)
  const active = useRef<string | null>(null)
  const mounted = useRef(false)
  const epochs = useRef({ history: 0, source: 0 })
  const filters = (): EvidenceFilters => ({
    ...(folder ? { folderId: folder } : {}),
    ...(from ? { dateFrom: from + 'T00:00:00.000Z' } : {}),
    ...(before ? { dateBefore: before + 'T00:00:00.000Z' } : {})
  })
  const refresh = useCallback(async (): Promise<void> => {
    const ticket = ++epochs.current.history
    epochs.current.source++
    setSource(null)
    setSourceLoading(false)
    setUnsaved(null)
    setEntries([])
    setChecking(true)
    setCensus(null)
    try {
      const result = await window.citedAsk.history()
      if (!mounted.current || ticket !== epochs.current.history) return
      setEntries(result.entries)
      if (result.error) setError(result.error)
    } catch {
      if (mounted.current && ticket === epochs.current.history)
        setError('History could not be checked. Retry.')
    } finally {
      if (mounted.current && ticket === epochs.current.history) setChecking(false)
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    void Promise.resolve().then(() => {
      if (mounted.current) void refresh()
    })
    const ownership = epochs.current
    const off = window.citedAsk.onChanged(() => {
      void refresh()
    })
    const offProgress = window.citedAsk.onProgress((event) => {
      if (active.current === event.runId) setPhase(event.phase)
    })
    const wake = (): void => {
      void refresh()
    }
    window.addEventListener('focus', wake)
    return () => {
      mounted.current = false
      ownership.history++
      ownership.source++
      off()
      offProgress()
      window.removeEventListener('focus', wake)
      if (active.current) void window.citedAsk.cancel(active.current).catch(() => {})
    }
  }, [refresh])
  const ask = async (preset?: string): Promise<void> => {
    if (active.current) return
    const text = preset ?? question
    if (!text.trim()) return
    setQuestion(text)
    setError(null)
    setNeedsModel(false)
    setUnsaved(null)
    setPhase('queued')
    const runId = crypto.randomUUID()
    active.current = runId
    const admission = ++epochs.current.history
    setChecking(false)
    try {
      const result = await window.citedAsk.ask({ runId, question: text, filters: filters() })
      if (!mounted.current || active.current !== runId || admission !== epochs.current.history)
        return
      if (result.status === 'error') {
        setError(result.message)
        setNeedsModel(result.code === 'model-absent')
        return
      }
      if (result.saved) {
        setEntries((current) => [
          ...current.filter((e) => e.id !== runId),
          {
            id: runId,
            question: text,
            askedAt: result.snapshot.askedAt,
            status: 'valid',
            snapshot: result.snapshot
          }
        ])
        setChecking(false)
      } else {
        setUnsaved(result)
        setError(result.saveError ?? 'The answer was not saved.')
      }
    } catch {
      if (mounted.current) setError('The local answer could not be completed. Retry.')
    } finally {
      if (active.current === runId) {
        active.current = null
        if (mounted.current) setPhase(null)
      }
    }
  }
  const cancel = async (): Promise<void> => {
    if (!active.current) return
    setPhase('cancelling')
    try {
      await window.citedAsk.cancel(active.current)
    } catch {
      if (mounted.current)
        setError('Cancellation could not be acknowledged. Wait for the current run to finish.')
    }
  }
  const clear = async (): Promise<void> => {
    epochs.current.history++
    epochs.current.source++
    setError(null)
    setSource(null)
    setSourceLoading(false)
    setUnsaved(null)
    setEntries([])
    setChecking(true)
    try {
      await window.citedAsk.clear()
      if (mounted.current) await refresh()
    } catch {
      if (mounted.current) {
        setError('History could not be cleared. Existing history is preserved.')
        await refresh()
      }
    }
  }
  const openCitation = async (entryId: string, evidenceId: string): Promise<void> => {
    const ticket = ++epochs.current.source
    setSource(null)
    setSourceLoading(true)
    try {
      const view = await window.citedAsk.resolve(entryId, evidenceId)
      if (mounted.current && ticket === epochs.current.source)
        setSource({ entryId, evidenceId, view })
    } catch {
      if (mounted.current && ticket === epochs.current.source)
        setError('The original could not be checked. Retry.')
    } finally {
      if (mounted.current && ticket === epochs.current.source) setSourceLoading(false)
    }
  }
  const count = async (eligible = false): Promise<void> => {
    if (counting || (!eligible && !literal.trim())) return
    setCounting(true)
    setCensus(null)
    setError(null)
    const ticket = epochs.current.history
    try {
      const result = await window.citedAsk.census({
        filters: filters(),
        predicate: eligible ? { kind: 'eligible' } : { kind: 'literal', text: literal }
      })
      if (mounted.current && ticket === epochs.current.history) setCensus(result)
    } catch {
      if (mounted.current)
        setError('The requested source count is unavailable. Retry or narrow the filters.')
    } finally {
      if (mounted.current) setCounting(false)
    }
  }
  return (
    <section className="cited-home" aria-labelledby="cited-home-heading">
      <header>
        <div>
          <h2 id="cited-home-heading" className="home-heading">
            Ask your library
          </h2>
          <p className="cited-meta">
            On this device · Original personal notes and transcripts · No chat history used as
            evidence
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={!!phase || checking}>
          Recheck history
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void ask()
        }}
      >
        <label htmlFor="cited-question">Question</label>
        <textarea
          id="cited-question"
          maxLength={4096}
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What did we decide about the project?"
          disabled={!!phase}
        />
        <fieldset disabled={!!phase || counting} className="cited-filters">
          <legend>Sources · whole local library unless narrowed</legend>
          <label>
            Folder
            <select
              value={folder}
              onChange={(event) => {
                setFolder(event.target.value)
                setCensus(null)
              }}
            >
              <option value="">All folders</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From (UTC)
            <input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value)
                setCensus(null)
              }}
            />
          </label>
          <label>
            Before (UTC)
            <input
              type="date"
              value={before}
              onChange={(event) => {
                setBefore(event.target.value)
                setCensus(null)
              }}
            />
          </label>
        </fieldset>
        <div className="cited-home-actions">
          <button type="submit" disabled={!!phase || !question.trim()}>
            Ask on this device
          </button>
          <button type="button" disabled={!!phase} onClick={() => void ask(PAST_MENTIONS)}>
            Find past action-item mentions
          </button>
          {phase && (
            <button type="button" onClick={() => void cancel()} disabled={phase === 'cancelling'}>
              Cancel
            </button>
          )}
        </div>
        <p className="cited-meta">
          Requires a cached local notes model, even when Settings selects a cloud provider. No
          automatic download or cloud fallback.
        </p>
      </form>
      {phase && (
        <p role="status" aria-live="polite">
          {phase === 'cancelling'
            ? 'Cancelling; waiting for cleanup…'
            : `${phase.charAt(0).toUpperCase() + phase.slice(1)}…`}
        </p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {needsModel && (
            <button type="button" onClick={onOpenSettings}>
              Open Settings
            </button>
          )}
          <button type="button" disabled={!!phase} onClick={() => void ask()}>
            Retry question
          </button>
        </div>
      )}
      {sourceLoading && <p role="status">Checking original…</p>}
      {checking ? (
        <p role="status">Checking saved answers against current originals…</p>
      ) : (
        entries.map((entry) => (
          <section key={entry.id} className="cited-exchange">
            <h3>{entry.question}</h3>
            {entry.status === 'valid' ? (
              <CitedAnswer
                snapshot={entry.snapshot}
                onOpenCitation={(id) => openCitation(entry.id, id)}
              />
            ) : entry.status === 'legacy' ? (
              <>
                <p className="cited-meta">Earlier answer · sources not recorded</p>
                <p className="cited-claim-text">{entry.answer}</p>
              </>
            ) : (
              <p role="status">{entry.reason} Generate a new answer to use current sources.</p>
            )}
          </section>
        ))
      )}
      {unsaved && (
        <>
          <p role="status">Not saved. Citation navigation is available after a successful save.</p>
          <CitedAnswer
            snapshot={unsaved.snapshot}
            onOpenCitation={() => {
              setError(
                'This answer is not saved. Retry the question to save and open its citations.'
              )
            }}
          />
        </>
      )}
      {(entries.length > 0 || phase) && (
        <button type="button" onClick={() => void clear()}>
          Clear Home history
        </button>
      )}
      <details className="cited-census">
        <summary>Count literal matches</summary>
        <p>
          Deterministic counts, separate from generated answers. Every literal term must occur in
          the same original passage. This does not count semantic tasks or commitments.
        </p>
        <label>
          Literal words
          <input
            value={literal}
            disabled={counting || !!phase}
            maxLength={4096}
            onChange={(event) => setLiteral(event.target.value)}
          />
        </label>
        <div className="cited-home-actions">
          <button
            type="button"
            disabled={counting || !!phase || !literal.trim()}
            onClick={() => void count()}
          >
            Count matches
          </button>
          <button type="button" disabled={counting || !!phase} onClick={() => void count(true)}>
            Count eligible meetings
          </button>
        </div>
        {counting && <p role="status">Counting originals…</p>}
        {census && (
          <div role="status">
            <p>
              {census.predicate.predicate.kind === 'literal'
                ? `Literal words: ${census.predicate.predicate.text}`
                : 'All eligible originals'}
            </p>
            <p>
              {census.exact ? 'Observed exact count' : 'Observed lower bound (incomplete scan)'}:{' '}
              {census.meetingCount} meetings · {census.sourceCount} original passages
            </p>
            {!census.exact && <p>{census.unavailableCount} source units unavailable or changed.</p>}
            {census.unknownDateCount > 0 && (
              <p>{census.unknownDateCount} meetings excluded because their dates are unknown.</p>
            )}
            <ul>
              {census.meetings.map((m) => (
                <li key={m.meetingId}>{m.title || 'Untitled meeting'}</li>
              ))}
            </ul>
            {census.listTruncated && (
              <p>
                Only the first 100 matching meetings are listed; counts include all observed
                matches.
              </p>
            )}
          </div>
        )}
      </details>
      <OriginalPassagePanel
        view={source?.view ?? null}
        onClose={() => {
          epochs.current.source++
          setSource(null)
        }}
        onPlayAudio={async (token) => {
          if (!source) throw new Error('Original is no longer open.')
          return window.citedAsk.play(source.entryId, source.evidenceId, token)
        }}
      />
    </section>
  )
}
