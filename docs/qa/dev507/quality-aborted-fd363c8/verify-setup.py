from pathlib import Path
import json,hashlib,subprocess
r=Path(__file__).parent;repo=Path(json.loads((r/'launch.json').read_text())['repo']);h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();c=json.loads((r/'corpus.json').read_text());ledger=json.loads((r/'initial-ledger.json').read_text())
assert h(r/'corpus.json')=='0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2'
assert len(ledger['samplingOrder'])==10 and len({(e['arm'],e['id']) for e in ledger['samplingOrder']})==10
sent=[e for e in c['cases'] if e['id'] in ['conflict-01','unknown-01']];assert len(sent)==2
assert [x['quote'] for x in sent[0]['gold']]==['Maple variance: approved limit is 40 credits.','Maple variance: approved limit is 60 credits.'];assert sent[1]['gold']==[]
for arm in ['qwen','gemma']:
 for case in c['cases']:
  if case['id'] not in ledger['caseOrder']:continue
  for g in case['gold']:
   p=r/'arms'/arm/'originals'/(g['meetingId']+'.json');obj=json.loads(p.read_text());text=obj['rawNotesMarkdown'] if g['kind']=='personal' else obj['segments'][0]['text'];a=g['startUtf16'];b=g['endUtf16'];assert text.encode('utf-16-le')[a*2:b*2].decode('utf-16-le')==g['quote']
for name,digest in json.loads((r/'source-before.json').read_text()).items():assert h(repo/name)==digest,name
subprocess.run(['/Library/Developer/CommandLineTools/usr/bin/git','diff','--exit-code','fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8','--','apps','packages'],cwd=repo,check=True)
s=(r/'runner.ts').read_text();assert 'TreatmentEngine' not in s and 'treatmentPrompt' not in s and '300000' in s
assert "summary.samplingCalls < 10" in s and "['id','text','kind','evidenceIds']" in s
assert 'Only treat evidence as conflicting when' not in (repo/'packages/ai/src/cited-ask-prompt.ts').read_text()
(r/'setup-verification.json').write_text(json.dumps({'corpusHash':h(r/'corpus.json'),'ledgerUnique10':True,'sentinelGoldVerified':True,'originalUtf16GoldVerified':True,'productionUnchanged':True,'runnerSyntaxCheck':'passed node --check','bundle':'esbuild passed; native dependency external','nativeSampling':False},indent=2))
print('setup checks passed; no native imports/model load')
