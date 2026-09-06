"""Offline ONY-241 evaluation helpers. No model execution or network access."""
import argparse
import hashlib
import itertools
import json
import math
from pathlib import Path
import re
import unicodedata

LANGUAGES = {'en', 'da', 'es', 'fr', 'de'}


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Expected finite numeric measurement')
    return value


def tokens(text):
    # Unicode case folding; accents retained, punctuation ignored. Versioned policy.
    if not isinstance(text, str):
        raise ValueError('Expected transcript string')
    return re.findall(r'[^\W_]+', unicodedata.normalize('NFC', text).casefold())


def word_error(reference, hypothesis):
    reference, hypothesis = tokens(reference), tokens(hypothesis)
    # Myers bit-vector edit distance, arbitrary-length Python integers. Exact WER
    # without a quadratic Python loop for two-hour transcripts. No alignment output.
    length = len(reference)
    errors = length
    if length:
        masks = {}
        for i, word in enumerate(reference):
            masks[word] = masks.get(word, 0) | (1 << i)
        limit, high = (1 << length) - 1, 1 << (length - 1)
        positive, negative = limit, 0
        for word in hypothesis:
            equal = masks.get(word, 0)
            diagonal = (((equal & positive) + positive) ^ positive) | equal | negative
            horizontal_positive = negative | ~(diagonal | positive)
            horizontal_negative = positive & diagonal
            errors += bool(horizontal_positive & high) - bool(horizontal_negative & high)
            shifted = (horizontal_positive << 1) | 1
            positive = ((horizontal_negative << 1) | ~(diagonal | shifted)) & limit
            negative = diagonal & shifted & limit
    else:
        errors = len(hypothesis)
    return {'errors': errors, 'reference_words': len(reference),
            'wer': errors / len(reference) if reference else None}


def intervals(rows, duration):
    for row in rows:
        start, end = number(row['start']), number(row['end'])
        if not 0 <= start < end <= duration or not isinstance(row['speaker'], str) or not row['speaker']:
            raise ValueError('Invalid speaker interval')
    return rows


def diarization(reference, hypothesis, duration):
    """Exact interval DER, zero collar, overlap included, global optimal slot mapping.

    Up to four identities each; repeated/overlapping rows for one identity are unioned.
    Speaker-time denominator means DER can exceed 1 (false alarms).
    """
    number(duration)
    if duration <= 0:
        raise ValueError('Duration must be positive')
    intervals(reference, duration)
    intervals(hypothesis, duration)
    ref_ids = sorted({r['speaker'] for r in reference})
    hyp_ids = sorted({r['speaker'] for r in hypothesis})
    if max(len(ref_ids), len(hyp_ids)) > 4:
        raise ValueError('This benchmark supports at most four speaker identities')
    boundaries = sorted({0, duration} | {r[k] for r in reference + hypothesis for k in ('start', 'end')})
    spans = []
    for start, end in zip(boundaries, boundaries[1:]):
        t = (start + end) / 2
        spans.append((end - start,
                      {r['speaker'] for r in reference if r['start'] <= t < r['end']},
                      {r['speaker'] for r in hypothesis if r['start'] <= t < r['end']}))
    # Distinct opaque dummy values cannot collide with supplied speaker names.
    slots = ref_ids + [object() for _ in range(max(0, len(hyp_ids) - len(ref_ids)))]
    mappings = (dict(zip(hyp_ids, p)) for p in itertools.permutations(slots, len(hyp_ids)))
    best = None
    for mapping in mappings:
        totals = dict(reference_speaker_seconds=0.0, missed=0.0, false_alarm=0.0,
                      confusion=0.0, overlap_reference_seconds=0.0, overlap_error_seconds=0.0)
        for width, ref, hyp in spans:
            correct = len(ref & {mapping[h] for h in hyp})
            missed, false = max(0, len(ref) - len(hyp)), max(0, len(hyp) - len(ref))
            confusion = min(len(ref), len(hyp)) - correct
            totals['reference_speaker_seconds'] += width * len(ref)
            totals['missed'] += width * missed
            totals['false_alarm'] += width * false
            totals['confusion'] += width * confusion
            if len(ref) > 1:
                totals['overlap_reference_seconds'] += width * len(ref)
                totals['overlap_error_seconds'] += width * (missed + false + confusion)
        error = totals['missed'] + totals['false_alarm'] + totals['confusion']
        if best is None or error < best[0]:
            best = error, totals
    error, result = best
    result['der'] = error / result['reference_speaker_seconds'] if result['reference_speaker_seconds'] else None
    result['overlap_der'] = (result['overlap_error_seconds'] / result['overlap_reference_seconds']
                             if result['overlap_reference_seconds'] else None)
    return result


def percentile(values, fraction):
    if not values:
        return None
    for value in values:
        if number(value) < 0:
            raise ValueError('Negative latency')
    return sorted(values)[max(0, math.ceil(fraction * len(values)) - 1)]


def verify_artifacts(manifest, root):
    root = Path(root).resolve()
    seen = set()
    total = 0
    for item in manifest['files']:
        name = item['path']
        path = (root / name).resolve()
        if not path.is_relative_to(root) or path in seen:
            raise ValueError('Unsafe or duplicate artifact path')
        seen.add(path)
        if path.stat().st_size != item['size']:
            raise ValueError('Artifact size mismatch')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != item['sha256']:
            raise ValueError('Artifact digest mismatch')
        total += item['size']
    if not seen:
        raise ValueError('Empty manifest')
    return {'verified_files': len(seen), 'verified_bytes': total}


def score(run):
    if run['schema_version'] != 1 or run['language'] not in LANGUAGES:
        raise ValueError('Unsupported schema or launch language')
    kind = run['evidence_kind']
    if kind not in {'synthetic', 'physical-human-speech'}:
        raise ValueError('Explicit evidence kind required')
    # Metadata is operator attestation, not proof. Never emit release pass/fail.
    if kind == 'physical-human-speech':
        for key in ('consent_reference', 'device_model', 'os_build', 'app_commit',
                    'engine_versions', 'raw_artifact_reference', 'measurement_method'):
            if not run.get(key):
                raise ValueError('Missing physical evidence metadata: ' + key)
    duration = number(run['duration_seconds'])
    result = {'schema_version': 1, 'evidence_kind': kind, 'language': run['language'],
              'release_qualified': False, 'duration_seconds': duration,
              'input_sha256': hashlib.sha256(json.dumps(run, sort_keys=True, ensure_ascii=False,
                                                        allow_nan=False).encode()).hexdigest(),
              'transcription': word_error(run['reference_text'], run['hypothesis_text']),
              'speakers': diarization(run['reference_segments'], run['hypothesis_segments'], duration)}
    for metric in ('transcript_latency_seconds', 'speaker_latency_seconds'):
        values = run.get(metric, [])
        result[metric] = {'count': len(values), 'p50': percentile(values, .5), 'p95': percentile(values, .95)}
    # Identity is evaluated without permutation: expected/assigned are consented pseudonyms.
    decisions = run.get('identity_decisions', [])
    accepted = [d for d in decisions if d['assigned'] is not None]
    unknown = [d for d in decisions if d['expected'] is None]
    result['identity'] = {'accepted': len(accepted),
        'wrong_accepts': sum(d['assigned'] != d['expected'] for d in accepted),
        'unknown_trials': len(unknown),
        'unknown_false_accepts': sum(d['assigned'] is not None for d in unknown)}
    probes = run.get('retrieval_probes', [])
    scored = [p for p in probes if p['relevant_ids']]
    result['retrieval'] = {'scored_queries': len(scored),
        'macro_recall_at_5': (sum(len(set(p['relevant_ids']) & set(p['retrieved_ids'][:5])) /
                                    len(set(p['relevant_ids'])) for p in scored) / len(scored)) if scored else None,
        'forbidden_hits': sum(len(set(p.get('forbidden_ids', [])) & set(p['retrieved_ids'])) for p in probes)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    scoring = sub.add_parser('score')
    scoring.add_argument('run', type=Path)
    hashes = sub.add_parser('verify-artifacts')
    hashes.add_argument('manifest', type=Path)
    hashes.add_argument('root', type=Path)
    args = parser.parse_args()
    try:
        result = score(json.loads(args.run.read_text())) if args.command == 'score' else verify_artifacts(
            json.loads(args.manifest.read_text()), args.root)
        print(json.dumps(result, indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError, OSError, AttributeError) as error:
        # No payload/path echo: private fixture details stay local.
        parser.exit(2, 'Invalid or unavailable benchmark input (' + type(error).__name__ + ')\n')


if __name__ == '__main__':
    main()
