import assert from 'node:assert/strict'
import type { CitedPromptInput, CitedGenerationOutput } from '@repo/ai'
import type { SourceResolution } from '@repo/meetings-store/source-contract'
import type { EvidenceMeetingMeta } from '@repo/meetings-store/evidence-contract'
import { projectSources } from '@repo/meetings-store/sources'
import type { CitedAskRequest, CitationView } from '../../src/shared/cited-ask-api'
import { MainCitedAskService, type CitedAskDependencies } from '../../src/main/cited-ask-service'
import { BriefService } from '../../src/main/brief-service'
import { containsGold, sha256, type Corpus, type Scenario, type Gold } from './corpus.mjs'
import { createFixture } from './fixture.mjs'

export interface Generator {
  mode: 'mechanical' | 'native'
  generate: CitedAskDependencies['generate']
  validateModel: CitedAskDependencies['validateModel']
}
export const MECHANICAL_STOP = 'DEV509 mechanical boundary: no inference or generated answer'
export const mechanicalGenerator: Generator = {
  mode: 'mechanical',
  generate: async () => {
    throw new Error(MECHANICAL_STOP)
  },
  validateModel: async () => {
    throw new Error('Mechanical run cannot validate a model it never loaded')
  }
}
export async function evaluateCase(
  corpus: Corpus,
  item: Scenario,
  generator: Generator,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const fixture = await createFixture(corpus, item)
  const requests: CitedAskRequest[] = []
  const inputs: CitedPromptInput[] = []
  const outputs: Array<
    CitedGenerationOutput & { engineId: string; modelArtifactRevision: string }
  > = []
  const generatorErrors: string[] = []
  const started = performance.now()
  const shared = new MainCitedAskService({
    sources: fixture.sources,
    activity: fixture.activity,
    validateModel: generator.validateModel,
    generate: async (input, signal) => {
      inputs.push(structuredClone(input))
      try {
        const output = await generator.generate(input, signal)
        outputs.push(structuredClone(output))
        return output
      } catch (e) {
        generatorErrors.push(e instanceof Error ? e.message : String(e))
        throw e
      }
    }
  })
  const briefs = new BriefService({
    store: fixture.store,
    originals: fixture.metadata,
    activity: fixture.activity,
    calendar: fixture.calendar,
    publish: () => {},
    cited: {
      run: (request, control) => {
        requests.push(structuredClone(request))
        return shared.run(request, control)
      },
      validate: shared.validate.bind(shared),
      resolveCitation: shared.resolveCitation.bind(shared),
      cancel: shared.cancel.bind(shared)
    }
  })
  const cancel = (): void => {
    void briefs.dispose()
  }
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    signal?.throwIfAborted()
    const sourceBundle = await fixture.sources.retrieveEvidence(
      {
        mode: 'linked-history',
        meetingIds: item.expected.selectedMeetingIds,
        topic: item.topic
      },
      signal
    )
    const gold: Array<{
      expected: Gold
      resolved: SourceResolution
      metadata: EvidenceMeetingMeta | undefined
      exact: boolean
      retrieved: boolean
    }> = []
    for (const expected of item.expected.gold) {
      const original = item.originals.find((o) => o.id === expected.meetingId)!
      const passage = projectSources(original, fixture.scope)!.passages.find(
        (p) => p.anchor.sourceId === expected.sourceId && p.anchor.kind === expected.kind
      )!
      assert(passage, 'Frozen gold references a missing original passage')
      const resolved = await fixture.sources.resolveAcknowledged(passage.anchor, signal)
      const meta = sourceBundle.meetings.find((m) => m.meetingId === expected.meetingId)
      gold.push({
        expected,
        resolved,
        metadata: meta,
        exact:
          resolved.status === 'resolved' &&
          resolved.passage.text.slice(expected.startUtf16, expected.endUtf16) === expected.quote &&
          meta?.occurredAt === expected.occurredAt &&
          meta?.dateBasis === expected.dateBasis,
        retrieved: sourceBundle.ranges.some((r) => containsGold(r, expected))
      })
    }
    signal?.throwIfAborted()
    const opened = await briefs.open('synthetic-evaluator', fixture.event.id)
    signal?.throwIfAborted()
    const view = await briefs.generate('synthetic-evaluator', opened.sessionId, `run-${item.id}`, {
      topic: item.topic,
      ...(item.selection === 'none' ? { meetingIds: [] } : {})
    })
    const citations: Array<{ id: string; view: CitationView; exact: boolean }> = []
    for (const id of new Set(view.result?.snapshot.claims.flatMap((c) => c.evidenceIds) ?? [])) {
      const citation = await briefs.citation('synthetic-evaluator', opened.sessionId, id)
      const expectedMeta =
        citation.status === 'resolved'
          ? sourceBundle.meetings.find((m) => m.meetingId === citation.range.anchor.meetingId)
          : undefined
      citations.push({
        id,
        view: citation,
        exact:
          citation.status === 'resolved' &&
          citation.passage.text.slice(citation.range.startUtf16, citation.range.endUtf16) ===
            citation.range.quote &&
          citation.occurredAt === expectedMeta?.occurredAt &&
          citation.dateBasis === expectedMeta?.dateBasis
      })
    }
    const request = requests.at(-1)
    const selected =
      request?.selection.mode === 'linked-history' ? request.selection.meetingIds : undefined
    const selectedMatches =
      JSON.stringify(selected?.slice().sort()) ===
      JSON.stringify(item.expected.selectedMeetingIds.slice().sort())
    const forbidden = new Set([
      ...item.foreignOriginals.map((o) => o.id),
      ...Object.keys(fixture.originalBytes).filter(
        (id) => !item.expected.selectedMeetingIds.includes(id)
      )
    ])
    const noLeak =
      sourceBundle.ranges.every((r) => !forbidden.has(r.anchor.meetingId)) &&
      inputs.every((input) => input.ranges.every((r) => !forbidden.has(r.anchor.meetingId))) &&
      outputs.every((output) =>
        output.inclusion.ranges.every((r) => !forbidden.has(r.anchor.meetingId))
      ) &&
      citations.every(
        (c) => c.view.status !== 'resolved' || !forbidden.has(c.view.range.anchor.meetingId)
      )
    const bytes = fixture.checkBytes()
    const noHistoryPass =
      item.expected.modelCalls !== 0 ||
      (inputs.length === 0 &&
        view.result?.snapshot.status === 'no-history' &&
        view.result.snapshot.claims.length === 0)
    const boundaryPass =
      item.expected.modelCalls === 0
        ? noHistoryPass
        : inputs.length === 1 &&
          outputs.length === 0 &&
          generatorErrors[0] === MECHANICAL_STOP &&
          view.state === 'error' &&
          view.message === MECHANICAL_STOP &&
          !view.result
    const goldEvidence = gold.map((g) => ({
      ...g,
      atGeneratorBoundary: inputs.some((i) => i.ranges.some((r) => containsGold(r, g.expected))),
      nativePromptIncluded:
        generator.mode === 'native'
          ? outputs.some((o) => o.inclusion.ranges.some((r) => containsGold(r, g.expected)))
          : null,
      citedInFinalAnswer:
        generator.mode === 'native'
          ? citations.some(
              (c) => c.view.status === 'resolved' && containsGold(c.view.range, g.expected)
            )
          : null
    }))
    const sourceChecksPass =
      sourceBundle.coverage.scanComplete &&
      selectedMatches &&
      noLeak &&
      bytes.originalsUnchanged &&
      bytes.contextUnchanged &&
      goldEvidence.every((g) => g.exact && g.retrieved && g.atGeneratorBoundary) &&
      inputs.length === item.expected.modelCalls &&
      noHistoryPass
    const statusAllowed =
      !!view.result &&
      item.expected.allowedSnapshotStatuses.includes(view.result.snapshot.status) &&
      (item.group !== 'clear' || view.result.snapshot.claims.length > 0)
    return {
      caseId: item.id,
      group: item.group,
      mode: generator.mode,
      native: generator.mode === 'native',
      semanticQuality: 'not-evaluated',
      elapsedMs: performance.now() - started,
      outcome:
        generator.mode === 'mechanical'
          ? !boundaryPass
            ? 'mechanical-failure'
            : item.expected.modelCalls
              ? 'mechanical-no-answer'
              : 'validated-no-history-without-model'
          : (view.result?.snapshot.status ?? 'error'),
      expected: item.expected,
      sourceChecksPass,
      mechanicalPass: generator.mode === 'mechanical' ? sourceChecksPass && boundaryPass : null,
      nativeMechanicalGatesPass:
        generator.mode === 'native'
          ? sourceChecksPass &&
            statusAllowed &&
            citations.every((c) => c.exact) &&
            goldEvidence.every((g) => g.nativePromptIncluded)
          : null,
      humanSupport: {
        status: 'pending',
        supported: null,
        factualAssertions: null,
        abstention: view.result?.snapshot.status === 'insufficient-evidence',
        claims:
          view.result?.snapshot.claims.map((c) => ({
            ...c,
            atomicAssertions: [],
            humanLabels: null
          })) ?? []
      },
      requests,
      inputs,
      outputs,
      generatorErrors,
      view,
      sourceBundle,
      gold: goldEvidence,
      citations,
      selectedMatches,
      noLeak,
      noHistoryPass,
      ...bytes,
      fixture: {
        event: fixture.event,
        originals: fixture.originalBytes,
        context: fixture.contextBytes,
        originalHashes: Object.fromEntries(
          Object.entries(fixture.originalBytes).map(([id, b]) => [id, sha256(b)])
        ),
        contextSha256: sha256(fixture.contextBytes),
        scope: fixture.scope
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    await briefs.dispose()
    await shared.invalidate()
    await fixture.dispose()
  }
}
