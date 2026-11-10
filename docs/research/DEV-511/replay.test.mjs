import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixtures } from './fixtures.mjs';
import { experiment, replay, score, summary } from './replay.mjs';

const fixture = id => makeFixtures().find(f => f.id === id);
const named = rows => rows.filter(r => r.suggestion || r.confirmedAttendeeId);

test('checked-in measurements reproduce exactly', () => {
  assert.deepEqual(summary(), JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8')));
});

test('clean three-person evidence provides suggestions, never asserted names', () => {
  const f = fixture('clean-three-person');
  const rows = replay(f.input);
  assert.equal(named(rows).length, 6);
  assert.deepEqual(rows.map(r => r.suggestion.attendeeId), ['Ada', 'Bo', 'Cy', 'Ada', 'Bo', 'Cy']);
  assert.ok(rows.every(r => r.confirmedAttendeeId === null && ['You', 'Them'].includes(r.label)));
  assert.ok(rows.every(r => r.suggestion.confidence === 'uncalibrated' && r.provenance.length));
  assert.equal(named(replay(f.input, 'channel-only')).length, 0);
});

test('overlap and shared-room microphones cannot collapse multiple people into one name', () => {
  const overlap = replay(fixture('overlap').input);
  assert.equal(overlap[2].suggestion, null);
  assert.equal(overlap[5].suggestion, null);
  const room = replay(fixture('shared-room-mic').input);
  assert.deepEqual(named(room).map(r => r.suggestion.attendeeId), ['Cy', 'Cy']);
});

test('reconnect requires a new explicit participant binding, not a name match', () => {
  const f = fixture('reconnect');
  const rows = replay(f.input);
  assert.equal(rows[4].suggestion, null);
  assert.equal(rows[5].suggestion.attendeeId, 'Cy');
  f.input.bindings.find(b => b.participantId === 'p1-new').fromMs = 4000;
  assert.equal(replay(f.input)[4].suggestion.attendeeId, 'Bo');
});

for (const id of ['denied', 'inaccessible', 'failed', 'uncertain-clock', 'stale-meetingId', 'stale-sessionId', 'stale-revision']) {
  test(`${id} fails to generic labels even with cached names in input`, () => {
    const rows = replay(fixture(id).input);
    assert.equal(named(rows).length, 0);
    assert.ok(rows.every(r => ['You', 'Them'].includes(r.label)));
  });
}

test('revocation invalidates subsequent observations; missing samples expire', () => {
  for (const id of ['revoked', 'missing-observations']) {
    const rows = replay(fixture(id).input);
    assert.equal(named(rows.slice(0, 2)).length, 2);
    assert.equal(named(rows.slice(2)).length, 0);
  }
});

test('manual corrections and rejection persist through disk reload and conflicting replay', () => {
  const f = fixture('manual-correction');
  const dir = mkdtempSync(join(tmpdir(), 'dev511-corrections-'));
  try {
    const path = join(dir, 'synthetic-corrections.json');
    writeFileSync(path, JSON.stringify(f.input.corrections));
    f.input.corrections = JSON.parse(readFileSync(path, 'utf8'));
    for (const method of ['channel-only', 'observations']) {
      const rows = replay(f.input, method);
      assert.equal(rows[1].label, 'Bo');
      assert.equal(rows[1].confirmedAttendeeId, 'Bo');
      assert.equal(rows[1].suggestion, null);
      assert.equal(rows[2].reason, 'manual-rejection');
      assert.equal(rows[2].suggestion, null);
    }
    assert.deepEqual(replay(f.input), replay(JSON.parse(JSON.stringify(f.input))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('corrections do not leak across meetings, sessions, source revisions or segments', () => {
  for (const key of ['meetingId', 'sessionId', 'revision', 'segmentId']) {
    const f = fixture('manual-correction');
    for (const c of f.input.corrections) c[key] = key === 'revision' ? 2 : 'other';
    assert.ok(replay(f.input).every(r => r.confirmedAttendeeId === null));
  }
  const f = fixture('clean-three-person');
  f.input.segments[0].revision = 0;
  assert.equal(replay(f.input)[0].reason, 'stale-segment');
});

test('late callbacks cannot be used before the segment decision deadline', () => {
  const f = fixture('clean-three-person');
  for (const o of f.input.observations) o.receivedMs += 100000;
  assert.equal(named(replay(f.input)).length, 0);
});

test('input order does not alter replay and input remains immutable', () => {
  const f = fixture('clean-three-person');
  const original = structuredClone(f.input);
  const expected = replay(f.input);
  assert.deepEqual(f.input, original);
  f.input.observations.reverse();
  assert.deepEqual(replay(f.input), expected);
});

test('misleading UI produces a measurable wrong suggestion, not a confirmed fact', () => {
  const f = fixture('misleading-ui');
  const measured = score(replay(f.input), f.truth);
  assert.equal(measured.falseNames, 1);
  assert.equal(measured.named, 6);
  assert.equal(measured.falseConfirmed, 0);
  assert.equal(measured.confirmed, 0);
});

test('lag sensitivity exposes transition errors; known-lag correction is only an oracle', () => {
  const rows = experiment().lagSensitivity;
  const lag = ms => rows.find(r => r.lagMs === ms);
  assert.equal(lag(500).uncorrected.unknown, 6);
  assert.equal(lag(1000).uncorrected.falseNames, 5);
  assert.equal(lag(1000).uncorrected.named, 5);
  assert.ok(rows.every(r => r.oracleCorrected.falseNames === 0 && r.oracleCorrected.named === 6));
});

test('scoring reports denominators, undefined empty rates, and overlap errors honestly', () => {
  const empty = score([], {});
  assert.equal(empty.falseNameRateAmongNamed, null);
  assert.equal(empty.unknownRate, null);
  const r = { segmentId: 'x', confirmedAttendeeId: null, suggestion: { attendeeId: 'Bo' } };
  assert.equal(score([r], { x: ['Bo', 'Cy'] }).falseNames, 1);
  assert.throws(() => score([r], {}), /Missing truth/);
  for (const method of experiment().measurements) {
    assert.equal(method.total.segments, 96);
    assert.equal(method.total.named + method.total.unknown, method.total.segments);
    assert.equal(method.total.confirmed + method.total.suggestions, method.total.named);
  }
});

test('invalid experiment options and malformed timing cannot yield names', () => {
  const f = fixture('clean-three-person');
  for (const options of [{ tickMs: 0 }, { coverage: 2 }, { maxAgeMs: NaN }, { settleMs: -1 }]) {
    assert.throws(() => replay(f.input, 'observations', options), /Invalid replay/);
  }
  f.input.segments[0].endMs = 0;
  assert.throws(() => replay(f.input), /Invalid segment/);
});
