"""Summarize immutable synthetic native evidence; never infer human semantics."""
import collections
import gzip
import hashlib
import json
import pathlib
import sys
import subprocess
import platform

root = pathlib.Path(sys.argv[1]).resolve()
output = pathlib.Path(sys.argv[2]).resolve()
assert str(root).startswith('/private/tmp/dev507-native-')
summary = json.loads((root / 'summary.json').read_text())
corpus_bytes = (root / 'corpus.json').read_bytes()
corpus = json.loads(corpus_bytes)
assert hashlib.sha256(corpus_bytes).hexdigest() == summary['corpusHash']
assert summary['corpusHash'] == '0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2'
cases = summary['cases']
assert len({c['id'] for c in cases}) == len(cases)
assert {c['id'] for c in cases} <= {c['id'] for c in corpus['cases']}
records = []
for case in cases:
    record = json.loads((root / 'evidence' / (case['id'] + '.json')).read_text())
    assert record['record']['id'] == case['id']
    assert record['record']['status'] == case['status']
    generated = (record.get('generation') or {}).get('output')
    if generated and record['observed']:
        actual = record['observed'][-1]
        inclusion = generated['inclusion']
        assert inclusion['wireSha256'] == actual['wireSha256']
        assert inclusion['inputTokens'] == len(actual['wireTokens'])
        assert inclusion['inputTokens'] + inclusion['outputReserveTokens'] + inclusion['safetyMarginTokens'] <= actual['contextSize']
        wire = json.loads(actual['user'])
        assert [(r['id'],r['quote']) for r in inclusion['ranges']] == [(r['id'],r['quote']) for r in wire['evidence']]
        if 'responseText' in actual: assert actual['responseText'] == generated['rawJson']
    records.append(record)

roots = sorted({c['sourceRun'] for c in cases} | {str(root)})
provenance = []
for name in roots:
    path = pathlib.Path(name)
    assert name.startswith('/private/tmp/dev507-native-')
    launch = json.loads((path / 'launch.json').read_text())
    before = json.loads((path / 'model-before.json').read_text())
    after = json.loads((path / 'model-after.json').read_text())
    assert before == after
    exit_record = json.loads((path / 'exit.json').read_text())
    assert exit_record['modelUnchanged']
    provenance.append({'root': name, 'launch': launch, 'modelIntegrity': after,
                       'nodeVersion': subprocess.check_output([launch['node'],'--version'],text=True).strip(),
                       'nodeBinarySha256': hashlib.sha256(pathlib.Path(launch['node']).read_bytes()).hexdigest(),
                       'exit': exit_record,
                       'originalIntegrity': json.loads((path / 'original-integrity.json').read_text())})

def group(name, predicate, denominator):
    selected = [c for c in cases if predicate(c)]
    return {'name': name, 'frozenDenominator': denominator, 'attempted': len(selected),
            'unperformed': denominator-len(selected),
            'outcomes': dict(collections.Counter(c['code'] or c['status'] for c in selected)),
            'actualWireObserved': sum(c['wireObserved'] for c in selected),
            'allGoldOnActualWire': sum(c['wireObserved'] and bool(c['goldOnWire']) and all(c['goldOnWire']) for c in selected),
            'currentRequestValidated': sum((c.get('validation') or {}).get('status') == 'valid' for c in selected)}

prior_attempts = []
for attempt in summary['priorAttempts']:
    path = pathlib.Path(attempt['sourceRun']) / 'evidence' / (attempt['id']+'.json')
    prior_attempts.append({'adjudication':attempt,'evidence':json.loads(path.read_text())})
packet = b''.join((json.dumps(record, ensure_ascii=False, separators=(',', ':'))+'\n').encode() for record in records)
archive = output.with_name('native-evidence-79e506a.jsonl.gz')
archive.write_bytes(gzip.compress(packet, mtime=0))
report = {**{k: summary[k] for k in ['sourceSha','corpusHash','modelSha','temperature','transport']},
          'environment': {'os':subprocess.check_output(['/usr/bin/sw_vers','-productVersion'],text=True).strip(),'osBuild':subprocess.check_output(['/usr/bin/sw_vers','-buildVersion'],text=True).strip(),'kernel':platform.release(),'arch':platform.machine(),'nodeLlamaCpp':'3.20.0'},
          'productionGate': 'off', 'humanSemanticScoring': 'UNPERFORMED; designated independent human required',
          'uniqueCases': len(cases), 'totalFrozenCases': len(corpus['cases']),
          'groups': [group('must20', lambda c: c.get('retrievalSet') == 'must20', 20),
                     group('semantic80', lambda c: c.get('retrievalSet') != 'must20', 80)],
          'unperformedIds': summary['unperformed'], 'priorAttempts': prior_attempts,
          'priorHistorical72Run': '/private/tmp/dev507-native-cbietv61 (three completed cases, one interrupted; excluded from current79 accounting)',
          'runProvenance': provenance,
          'packet': {'file': archive.name, 'records': len(records), 'uncompressedBytes': len(packet),
                     'gzipBytes': archive.stat().st_size, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()},
          'timingLimitations': '701 originals; direct I/O adapter, not desktop worker/IPC/UI persistence. Some software checks overlapped. First3 cases have combined run/admission only. Observed durations are not isolated performance acceptance.',
          'cases': cases}
output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'report':str(output),'cases':len(cases),'packetBytes':archive.stat().st_size,'groups':report['groups']},indent=2))
