// Entirely fictional identities and scripted metadata; no audio or app adapter.
const scope = { meetingId: 'synthetic-meeting', sessionId: 'capture-1', revision: 1 };
const people = ['Ada', 'Bo', 'Cy'];
const bindings = people.map((person, i) => ({
  participantId: `p${i}`, attendeeId: person, fromMs: 0, toMs: 6000,
}));

// Inputs and scoring truth are separate. The matcher never receives truth.
function fixture(id, turns = ['Ada', 'Bo', 'Cy', 'Ada', 'Bo', 'Cy']) {
  const segments = turns.map((_, i) => ({
    ...scope, id: `s${i}`, startMs: i * 1000, endMs: (i + 1) * 1000,
    channel: i % 3 === 0 ? 'mic' : 'system',
  }));
  const observations = turns.flatMap((turn, i) => Array.from({ length: 4 }, (_, j) => ({
    ...scope, id: `o${i}-${j}`, observedMs: i * 1000 + j * 250,
    receivedMs: i * 1000 + j * 250,
    activeParticipantIds: (Array.isArray(turn) ? turn : [turn]).map(p => `p${people.indexOf(p)}`),
    status: 'ok',
  })));
  return {
    id, description: id, input: { scope: { ...scope }, segments, observations,
      bindings: structuredClone(bindings), corrections: [],
      clock: { offsetMs: 0, uncertaintyMs: 0 } },
    truth: Object.fromEntries(turns.map((p, i) => [`s${i}`, Array.isArray(p) ? p : [p]])),
  };
}

export function makeFixtures() {
  const clean = fixture('clean-three-person');
  const overlap = fixture('overlap', ['Ada', 'Bo', ['Bo', 'Cy'], 'Ada', 'Cy', ['Ada', 'Bo']]);
  const reconnect = fixture('reconnect');
  // p1 is retired. Its display name is irrelevant; p1-new has no binding until 4500.
  reconnect.input.bindings[1].toMs = 2000;
  reconnect.input.bindings.push({ participantId: 'p1-new', attendeeId: 'Bo', fromMs: 4500, toMs: 6000 });
  for (const o of reconnect.input.observations) if (o.observedMs >= 4000) {
    o.activeParticipantIds = o.activeParticipantIds.map(p => p === 'p1' ? 'p1-new' : p);
  }
  const shared = fixture('shared-room-mic');
  shared.input.bindings = [
    ...bindings.filter(b => b.attendeeId === 'Cy'),
    { participantId: 'room', attendeeId: 'Ada', fromMs: 0, toMs: 6000 },
    { participantId: 'room', attendeeId: 'Bo', fromMs: 0, toMs: 6000 },
  ];
  for (const o of shared.input.observations) o.activeParticipantIds = o.activeParticipantIds.map(p => p === 'p2' ? p : 'room');
  for (const s of shared.input.segments) if (s.channel === 'system' && shared.truth[s.id][0] === 'Bo') s.channel = 'mic';
  const lag = fixture('lag-and-clock-offset');
  lag.input.clock = { offsetMs: 400, uncertaintyMs: 50 };
  for (const o of lag.input.observations) { o.observedMs += 1400; o.receivedMs += 1000; }
  const uncertain = fixture('uncertain-clock');
  uncertain.input.clock.uncertaintyMs = 600;
  const stale = ['meetingId', 'sessionId', 'revision'].map(field => {
    const f = fixture(`stale-${field}`);
    for (const o of f.input.observations) o[field] = field === 'revision' ? 0 : 'old';
    return f;
  });
  const failures = ['denied', 'revoked', 'inaccessible', 'failed'].map(status => {
    const f = fixture(status);
    for (const o of f.input.observations) if (status !== 'revoked' || o.observedMs >= 2000) {
      o.status = status;
      // Intentionally retain names: status MUST invalidate cached identity.
    }
    return f;
  });
  const manual = fixture('manual-correction');
  manual.input.corrections = [
    { ...scope, segmentId: 's1', attendeeId: 'Bo' },
    { ...scope, segmentId: 's2', attendeeId: null }, // explicit rejection survives replay
  ];
  for (const o of manual.input.observations) if (o.observedMs >= 1000 && o.observedMs < 3000) o.activeParticipantIds = ['p0'];
  const misleading = fixture('misleading-ui');
  for (const o of misleading.input.observations) if (o.observedMs >= 1000 && o.observedMs < 2000) o.activeParticipantIds = ['p2'];
  const missing = fixture('missing-observations');
  missing.input.observations = missing.input.observations.filter(o => o.observedMs < 2000);
  return [clean, overlap, reconnect, shared, lag, uncertain, ...stale, ...failures, manual, misleading, missing];
}
