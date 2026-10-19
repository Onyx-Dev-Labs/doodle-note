import type { CitedAnswerSnapshot } from '../../shared/cited-ask-api'

export interface CitedAnswerProps {
  /** Consumer must admit this snapshot with the current request before rendering. */
  snapshot: CitedAnswerSnapshot
  onOpenCitation(evidenceId: string): void | Promise<void>
}
export default function CitedAnswer({
  snapshot,
  onOpenCitation
}: CitedAnswerProps): React.JSX.Element {
  const coverage = snapshot.evidence.coverage
  const included = snapshot.prompt?.ranges.length ?? 0
  const completeSelection = coverage.selectionComplete && (snapshot.prompt?.budgetComplete ?? true)
  return (
    <section className="cited-answer" aria-label="Answer with original citations">
      <p className="cited-meta">
        {snapshot.prompt ? 'Generated locally' : 'Checked on this device'} ·{' '}
        {new Date(snapshot.askedAt).toLocaleString()}
      </p>
      {snapshot.status === 'no-history' && <p>No linked history is available for this request.</p>}
      {snapshot.status === 'insufficient-evidence' && (
        <p>The selected originals do not provide enough evidence to answer.</p>
      )}
      {snapshot.status === 'conflicting-evidence' && (
        <p role="status">The originals contain conflicting evidence.</p>
      )}
      {snapshot.claims.map((claim) => (
        <article key={claim.id}>
          <span className="cited-claim-kind">
            {claim.kind === 'quotation'
              ? 'Verified original quotation'
              : claim.kind === 'conflict'
                ? 'Generated comparison of conflicting originals'
                : 'Generated summary'}
          </span>
          <p className="cited-claim-text">{claim.text}</p>
          <div className="cited-citations">
            {claim.evidenceIds.map((id, index) => {
              const range = snapshot.prompt?.ranges.find((r) => r.id === id)
              const meeting = snapshot.evidence.meetings.find(
                (m) => m.meetingId === range?.anchor.meetingId
              )
              return (
                <button key={id} type="button" onClick={() => void onOpenCitation(id)}>
                  {index + 1}. {meeting?.title || 'Original'} ·{' '}
                  {meeting?.occurredAt
                    ? `${meeting.dateBasis === 'createdAt' ? 'Created' : 'Meeting'} ${new Date(meeting.occurredAt).toLocaleDateString()}`
                    : 'Date unknown'}
                </button>
              )
            })}
          </div>
        </article>
      ))}
      <details className="cited-coverage">
        <summary>
          Coverage: {coverage.eligibleMeetingCount} eligible meetings · {included} passages sent
        </summary>
        <p>
          {coverage.scanComplete
            ? 'The complete requested source domain was scanned.'
            : 'The requested source scan was incomplete.'}{' '}
          {completeSelection
            ? 'All selected ranges fit this request.'
            : 'Some matching passages or query terms were omitted from this request.'}
        </p>
        <p>
          Examples are not an exhaustive semantic search or an exact total. Historical commitments
          do not establish that work remains outstanding.
        </p>
        {coverage.unknownDateCount > 0 && (
          <p>
            {coverage.unknownDateCount} meetings with unknown dates were excluded by the date
            filter.
          </p>
        )}
        {!!coverage.droppedTerms.length && <p>Terms omitted: {coverage.droppedTerms.join(', ')}</p>}
        {!!coverage.omissions.length && <p>Selection limits: {coverage.omissions.join(', ')}</p>}
        {snapshot.prompt && !snapshot.prompt.budgetComplete && (
          <p>The local model budget required shorter passages or fewer passages.</p>
        )}
      </details>
    </section>
  )
}
