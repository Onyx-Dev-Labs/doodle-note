import { pathToFileURL } from 'node:url';
import { makeFixtures } from './fixtures.mjs';

export const DEFAULTS = Object.freeze({
  tickMs: 250, maxAgeMs: 500, coverage: 0.75,
  maxClockUncertaintyMs: 250, lagCorrectionMs: 0, settleMs: 1500,
});
const sameScope = (a, b) => ['meetingId', 'sessionId', 'revision'].every(k => a[k] === b[k]);
const generic = s => s.channel === 'mic' ? 'You' : 'Them';

// Research contract only. No production imports, IPC, permissions, network or audio.
export function replay(input, method = 'observations', overrides = {}) {
  if (!['channel-only', 'observations'].includes(method)) throw new Error('Unknown method');
  const cfg = { ...DEFAULTS, ...overrides };
  if (!Number.isFinite(cfg.tickMs) || cfg.tickMs <= 0 ||
      !Number.isFinite(cfg.coverage) || cfg.coverage <= 0 || cfg.coverage > 1 ||
      !['maxAgeMs', 'maxClockUncertaintyMs', 'lagCorrectionMs', 'settleMs'].every(k => Number.isFinite(cfg[k]) && cfg[k] >= 0)) {
    throw new Error('Invalid replay parameters');
  }
  return input.segments.map(segment => {
    if (!(Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) && segment.endMs > segment.startMs)) throw new Error('Invalid segment interval');
    const result = { segmentId: segment.id, label: generic(segment), confirmedAttendeeId: null,
      suggestion: null, reason: 'channel-only', provenance: [] };
    if (!sameScope(segment, input.scope)) return { ...result, reason: 'stale-segment' };
    const manual = input.corrections.find(c => sameScope(c, segment) && c.segmentId === segment.id);
    if (manual) return { ...result, label: manual.attendeeId ?? generic(segment),
      confirmedAttendeeId: manual.attendeeId, reason: manual.attendeeId === null ? 'manual-rejection' : 'manual',
      provenance: ['manual:segment-correction'] };
    if (method === 'channel-only') return result;
    if (!Number.isFinite(input.clock.offsetMs) || !Number.isFinite(input.clock.uncertaintyMs) ||
        input.clock.uncertaintyMs < 0 || input.clock.uncertaintyMs > cfg.maxClockUncertaintyMs) {
      return { ...result, reason: 'uncertain-clock' };
    }
    const observations = input.observations.filter(o => sameScope(o, segment) &&
      Number.isFinite(o.observedMs) && Number.isFinite(o.receivedMs) &&
      o.receivedMs <= segment.endMs + cfg.settleMs)
      .map(o => ({ ...o, alignedMs: o.observedMs - input.clock.offsetMs - cfg.lagCorrectionMs }))
      .sort((a, b) => a.alignedMs - b.alignedMs || a.receivedMs - b.receivedMs || a.id.localeCompare(b.id));
    const votes = new Map();
    const provenance = new Set();
    let totalMs = 0;
    let veto = null;
    for (let t = segment.startMs; t < segment.endMs; t += cfg.tickMs) {
      const weight = Math.min(cfg.tickMs, segment.endMs - t);
      totalMs += weight;
      const sampleMs = t + weight / 2;
      const o = observations.findLast(o => o.alignedMs <= sampleMs);
      if (!o || sampleMs - o.alignedMs > cfg.maxAgeMs) continue;
      if (o.status !== 'ok') { veto = `adapter-${o.status}`; continue; }
      if (o.activeParticipantIds.length !== 1) { veto = 'overlap-or-no-active-speaker'; continue; }
      const bound = input.bindings.filter(b => b.participantId === o.activeParticipantIds[0] &&
        b.fromMs <= sampleMs && sampleMs < b.toMs);
      if (bound.length !== 1) { veto = 'ambiguous-or-unbound-participant'; continue; }
      votes.set(bound[0].attendeeId, (votes.get(bound[0].attendeeId) ?? 0) + weight);
      provenance.add(o.id);
    }
    if (veto) return { ...result, reason: veto };
    const ranked = [...votes].sort((a, b) => b[1] - a[1]);
    if (!ranked.length || ranked[0][1] / totalMs < cfg.coverage ||
        (ranked.length > 1 && ranked[0][1] === ranked[1][1])) return { ...result, reason: 'insufficient-coverage' };
    return { ...result, reason: 'unconfirmed-ui-suggestion', provenance: [...provenance],
      suggestion: { attendeeId: ranked[0][0], coverage: ranked[0][1] / totalMs,
        confidence: 'uncalibrated', evidence: 'synthetic-ui-observation' } };
  });
}

// Count single-name suggestions as if accepted, separately from actual assertions.
// Even a name present in an overlapping truth set is an incomplete assignment.
export function score(results, truth) {
  const totals = { segments: results.length, named: 0, falseNames: 0, unknown: 0,
    suggestions: 0, confirmed: 0, falseConfirmed: 0 };
  for (const r of results) {
    if (!truth[r.segmentId]?.length) throw new Error(`Missing truth for ${r.segmentId}`);
    const name = r.confirmedAttendeeId ?? r.suggestion?.attendeeId;
    const correct = truth[r.segmentId].length === 1 && truth[r.segmentId][0] === name;
    if (name == null) totals.unknown++;
    else { totals.named++; if (!correct) totals.falseNames++; }
    if (r.suggestion) totals.suggestions++;
    if (r.confirmedAttendeeId != null) { totals.confirmed++; if (!correct) totals.falseConfirmed++; }
  }
  return { ...totals, falseNameRateAmongNamed: totals.named ? totals.falseNames / totals.named : null,
    falseNameRateAllSegments: totals.segments ? totals.falseNames / totals.segments : null,
    unknownRate: totals.segments ? totals.unknown / totals.segments : null };
}

export function experiment() {
  const fixtures = makeFixtures();
  const methods = [
    { id: 'channel-only', method: 'channel-only', options: {} },
    { id: 'timestamped', method: 'observations', options: {} },
    { id: 'oracle-lag-corrected', method: 'observations', options: {} },
  ];
  const measurements = methods.map(m => {
    const allResults = [], allTruth = {};
    const scenarios = fixtures.map(f => {
      const options = m.id === 'oracle-lag-corrected' && f.id === 'lag-and-clock-offset' ? { lagCorrectionMs: 1000 } : m.options;
      const results = replay(f.input, m.method, options);
      for (const r of results) {
        const key = `${f.id}/${r.segmentId}`;
        allResults.push({ ...r, segmentId: key }); allTruth[key] = f.truth[r.segmentId];
      }
      return { fixture: f.id, ...score(results, f.truth), results };
    });
    return { method: m.id, total: score(allResults, allTruth), scenarios };
  });
  const lagSensitivity = [];
  for (const lagMs of [0, 250, 500, 750, 1000, 1500]) {
    const f = structuredClone(fixtures[0]);
    for (const o of f.input.observations) { o.observedMs += lagMs; o.receivedMs += lagMs; }
    lagSensitivity.push({ lagMs,
      uncorrected: score(replay(f.input), f.truth),
      oracleCorrected: score(replay(f.input, 'observations', { lagCorrectionMs: lagMs }), f.truth),
    });
  }
  return { kind: 'synthetic-metadata-replay-only', defaults: DEFAULTS,
    fixtureCount: fixtures.length, measurements, lagSensitivity };
}

export function summary() {
  const result = experiment();
  return { ...result, measurements: result.measurements.map(m => ({ ...m,
    scenarios: m.scenarios.map(({ results, ...counts }) => counts),
  })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--details')) {
    throw new Error('Only --details is accepted; inputs are checked-in synthetic fixtures');
  }
  console.log(JSON.stringify(process.argv[2] ? experiment() : summary(), null, 2));
}
