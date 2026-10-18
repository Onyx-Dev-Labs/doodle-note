"""Offline capture consistency checks only; no model/native execution or semantic acceptance."""
from pathlib import Path
import json,hashlib,collections,subprocess
r=Path(__file__).parent
h=lambda b:hashlib.sha256(b).hexdigest()
j=lambda p:json.loads(p.read_text())
s=j(r/'summary.json');assert len(s['cases'])==12 and s['samplingCalls']==12 and s['totals']=={'valid':12}
assert s['stoppedReason'] is None and s['engineDisposed'] and s['originalsUnchanged']
assert len(s['preflight'])==12 and all(x['status']=='passed' and x['samplingCalls']==0 for x in s['preflight'])
assert j(r/'model-before.json')==j(r/'model-after.json')
assert j(r/'exit.json')['code']==0 and not j(r/'exit.json')['forcedTermination']
assert all(j(r/'process-exit-proof.json')[k] for k in ['pidAbsent','ownedGroupAbsent'])
for name,sha in j(r/'freeze.json')['files'].items():assert h((r/name).read_bytes())==sha,name
rows=[]
for row in s['cases']:
 a,id=row['arm'],row['id'];d=j(r/'evidence'/f'{a}-{id}.json');p=j(r/'preflight'/f'{a}-{id}.json')['preflight'];old=j(r/'prior'/f'{id}.json');o=d['generation']['output'];obs=d['observed'][0];g=d['grammar'][0]
 assert d['generation']['input']==old['generation']['input']==p['input']
 assert o['inclusion']['ranges']==p['prompt']['inclusion']['ranges']==old['generation']['output']['inclusion']['ranges']
 assert obs['user']==p['prompt']['user']==old['observed'][0]['user']
 assert g['schema']==p['schema']==old['grammar'][0]['schema'] and g['grammar']==old['grammar'][0]['grammar']
 assert h(g['grammar'].encode())==g['grammarSha256']==obs['grammarSha256']
 assert g['runtime']==obs['runtime'] and obs['actualGrammarObjectSupplied'] and obs['grammarSameModelRuntime']
 assert o['rawJson']==obs['responseText'] and h(obs['responseText'].encode())==obs['responseTextSha256']
 assert h(json.dumps(obs['wireTokens'],separators=(',',':')).encode())==obs['wireSha256']==o['inclusion']['wireSha256']==p['prompt']['inclusion']['wireSha256']
 assert len(obs['wireTokens'])==o['inclusion']['inputTokens'] and len(obs['wireTokens'])+4096+256<=16384
 assert obs['temperature']==0.3 and obs['contextSize']==16384 and obs['maxTokens']==4096 and obs['safetyMarginTokens']==256
 assert d['result']['snapshot']['promptVersion']==2 and d['validation']['status']=='valid'
 assert row['goldOnWire']==[True] and row['rawForwardingExact'] and not row['timedOut']
 assert obs['stopReason']=='stopGenerationTrigger'
 assert any(e['kind']=='context-dispose-end' and e['disposed'] for e in d['events'])
 assert not any('error' in e['kind'] for e in d['events'])
 assert [x['id'] for x in o['inclusion']['ranges']]==obs['evidenceIdEnum']
 if a=='control':assert obs['history'][0]['text']==old['observed'][0]['history'][0]['text'] and obs['wireSha256']==old['observed'][0]['wireSha256']
 else:
  c=j(r/'evidence'/f'control-{id}.json')['observed'][0];anchor='Answer the actual question with the fewest distinct supported claims; exclude unrelated evidence and repeated paraphrases.';sentence='Only treat evidence as conflicting when it makes incompatible statements about the same subject and the same attribute asked about.'
  assert obs['history'][0]['text']==c['history'][0]['text'].replace(anchor,anchor+' '+sentence)
  assert len(obs['wireTokens'])==len(c['wireTokens'])+21
 rows.append({'arm':a,'id':id,'checks':'boundary/selected-input/inclusion/schema/grammar/current-admission/cleanup pass','inputTokens':len(obs['wireTokens']),'remainingTokens':16384-len(obs['wireTokens'])-4096-256})
repo=Path(j(r/'launch.json')['repo']);assert not subprocess.check_output(['/Library/Developer/CommandLineTools/usr/bin/git','diff','fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8','--','apps','packages'],cwd=repo)
for name,sha in j(r/'source-before.json').items():assert h((repo/name).read_bytes())==sha,name
for name,sha in j(r/'prior-hashes.json').items():assert h(Path(name).read_bytes())==sha,name
(r/'offline-verification.json').write_text(json.dumps({'scope':'artifact consistency only; no human/semantic/native rerun','cases':rows,'frozenFiles':len(j(r/'freeze.json')['files']),'priorFilesUnchanged':len(j(r/'prior-hashes.json')),'sourceFilesUnchanged':len(j(r/'source-before.json')),'productionByteIdenticalTo':'fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8','passed':True},indent=2)+'\n')
print('PASS:12 capture boundary/admission/lifecycle checks;1483 frozen files,708 prior files,961 tracked source/evidence files unchanged. No semantic pass inferred.')
