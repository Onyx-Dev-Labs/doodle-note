from pathlib import Path
import json,gzip,hashlib,subprocess,collections
repo=Path('/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c');p=repo/'docs/qa/dev507/quality-capability-f7f43c7';h=lambda b:hashlib.sha256(b).hexdigest()
m=json.loads((p/'MANIFEST.json').read_text())
for name,digest in m.items():assert h((p/name).read_bytes())==digest,name
records={}
for attempt in ['second-stopped','third-native']:
 with gzip.open(p/attempt/'records.jsonl.gz','rt')as f:
  for line in f:
   x=json.loads(line);assert h(x['rawUtf8'].encode())==x['sha256'];records[(attempt,x['path'])]=json.loads(x['rawUtf8'])
 s=json.loads((p/attempt/'summary.json').read_text());assert len(s['cases'])==8
 assert json.loads((p/attempt/'model-before.json').read_text())==json.loads((p/attempt/'model-after.json').read_text())
 assert json.loads((p/attempt/'process-proof.json').read_text())['pidAbsent']
 assert json.loads((p/attempt/'source-prior-freeze-integrity.json').read_text())=={'sourceUnchanged':True,'priorRootUnchanged':True,'frozenPlanRunnerArmsUnchanged':True}
 if attempt=='second-stopped':assert s['nativeGenerationCalls']==s['samplingCalls']==0 and s['totals']=={'failed':1,'unperformed':7}
 else:
  assert s['nativeGenerationCalls']==s['samplingCalls']==8 and s['totals']=={'valid':8} and s['stoppedReason']is None
  for row in s['cases']:
   d=records[(attempt,'evidence/gemma-'+row['id']+'.json')];pre=records[(attempt,'preflight/gemma-'+row['id']+'.json')]['preflight'];o=d['observed'][0];out=d['generation']['output']
   assert out['rawJson']==o['responseText']==o['observerRecords'][1]['responseText']
   assert o['observerRecords'][0]['wireJson']==pre['wrapperWire']
   assert o['wireTokens']==pre['wireTokens'];assert h(json.dumps(o['wireTokens'],separators=(',',':')).encode())==o['wireSha256']==out['inclusion']['wireSha256']
   assert d['result']['snapshot']['promptVersion']==3 and d['validation']['status']=='valid' and d['rawForwardingExact']
   assert o['actualGrammarObjectSupplied']and o['grammarSameModelRuntime']and o['runtime']['gpu']=='metal'and o['runtime']['buildType']=='prebuilt'
   assert row['inputTokens']+4096+256<=16384 and all(row['goldOnWire'])
   assert d['grammar'][0]['schema']==records[(attempt,'preflight/gemma-'+row['id']+'.json')]['grammar'][0]['schema']
   assert collections.Counter(x['kind']for x in d['sourceOperations'])['retrieve']==3
   assert collections.Counter(x['kind']for x in d['sourceOperations'])['manifest-validate']==3
with gzip.open(p/'synthetic-originals.jsonl.gz','rt')as f:
 originals=[json.loads(x)for x in f]
for x in originals:assert h(x['rawUtf8'].encode())==x['sha256']
assert len(originals)==702
claims=json.loads((p/'claim-source-pairs.json').read_text());assert sum(len(x['claims'])for x in claims)==18
for item in claims:
 for pair in item['claims']:
  if pair['raw']['kind']=='quotation':assert pair['admitted']['text']=='\n'.join(x['range']['quote']for x in pair['citedOriginals'])
g='/Library/Developer/CommandLineTools/usr/bin/git';subprocess.run([g,'diff','--exit-code','f7f43c7d8a898a61015650b44a218167c1dedf76','--','apps','packages'],cwd=repo,check=True)
result={'payloadMembersVerifiedExcludingAudit':len([n for n in m if n not in ['audit.py','audit.json']]),'recordHashesVerified':len(records),'originalFilesAndMarker':len(originals),'thirdNativeCalls':8,'thirdStrictCurrentValid':8,'rawAdmittedClaimPairs':18,'secondNativeCalls':0,'sourceProductionUnchanged':True,'wireGrammarForwardPolicyAndCleanup':True,'semanticAcceptance':'NOT CLAIMED'}
Path('/private/tmp/dev507-quality-final-work/audit.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
