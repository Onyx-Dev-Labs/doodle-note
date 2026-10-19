"""Offline artifact pairing, no model imports or automated entailment scoring."""
from pathlib import Path
import json,hashlib,collections,gzip
r=Path('/private/tmp/dev507-quality-third-ox_5jgyg');outroot=Path(__file__).parent
s=json.loads((r/'summary.json').read_text());assert s.get('endedAt');assert len(s['cases'])==8
out=[];originals={};deltas=[]
for row in s['cases']:
 p=r/'evidence'/('gemma-'+row['id']+'.json')
 if not p.exists():out.append({'id':row['id'],'record':row,'claims':[]});continue
 d=json.loads(p.read_text());o=(d.get('generation')or{}).get('output')or{}
 try:raw=json.loads(o.get('rawJson',''))
 except(ValueError,TypeError):raw=None
 ranges={x['id']:x for x in o.get('inclusion',{}).get('ranges',[])};admitted={c['id']:c for c in (d.get('result')or{}).get('snapshot',{}).get('claims',[])};pairs=[]
 for c in (raw or{}).get('claims',[]):
  cited=[]
  for id in c['evidenceIds']:
   x=ranges[id];mid=x['anchor']['meetingId'];p=r/'arms/gemma/originals'/(mid+'.json');b=p.read_bytes();originals[mid]={'id':mid,'sha256':hashlib.sha256(b).hexdigest(),'rawUtf8':b.decode()};cited.append({'range':x,'originalPath':str(p),'originalSha256':hashlib.sha256(b).hexdigest()})
  pairs.append({'raw':c,'admitted':admitted.get(c['id']),'citedOriginals':cited})
 reps={}
 for phase,claims in [('raw',(raw or{}).get('claims',[])),('admitted',list(admitted.values()))]:
  groups=collections.defaultdict(list)
  for c in claims:groups[c['text'].strip()].append(c['id'])
  groups=[{'text':t,'ids':ids,'excessCopies':len(ids)-1}for t,ids in groups.items()if len(ids)>1];reps[phase]={'groups':groups,'groupCount':len(groups),'excessCopies':sum(g['excessCopies']for g in groups)}
 out.append({'id':row['id'],'question':d.get('question'),'record':row,'rawStatus':(raw or{}).get('status'),'admittedStatus':(d.get('result')or{}).get('snapshot',{}).get('status'),'claims':pairs,'exactTextRepetition':reps})
for row in s['preflight']:
 id=row['id'];new=json.loads((r/'preflight'/('gemma-'+id+'.json')).read_text())['preflight'];old=json.loads((r/'baseline-gemma'/('gemma-'+id+'.json')).read_text())['preflight'];a=new['prompt']['inclusion'];b=old['prompt']['inclusion'];oldids={x['id']:x for x in b['ranges']};newids={x['id']:x for x in a['ranges']}
 deltas.append({'id':id,'oldBaseline':'INVALID missing-system preflight; comparison only','selectedInputUnchanged':new['input']==old['input'],'oldTokens':b['inputTokens'],'newTokens':a['inputTokens'],'headroom':16384-4096-256-a['inputTokens'],'oldIncludedCount':len(oldids),'newIncludedCount':len(newids),'removedRanges':[x for k,x in oldids.items()if k not in newids],'addedRanges':[x for k,x in newids.items()if k not in oldids],'changedSameIdRanges':[{'old':oldids[k],'new':v}for k,v in newids.items()if k in oldids and v!=oldids[k]],'newOmittedRangeIds':a['omittedRangeIds'],'newOmittedInputRanges':[x for x in new['input']['ranges']if x['id']in a['omittedRangeIds']],'goldOnWire':new['goldOnWire']})
(outroot/'claim-source-pairs.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');(outroot/'budget-deltas.json').write_text(json.dumps(deltas,ensure_ascii=False,indent=2)+'\n')
with gzip.GzipFile(filename=str(outroot/'cited-originals.jsonl.gz'),mode='wb',mtime=0)as f:
 for id in sorted(originals):f.write((json.dumps(originals[id],ensure_ascii=False,separators=(',',':'))+'\n').encode())
print(json.dumps({'cases':len(out),'claims':sum(len(x['claims'])for x in out),'citedOriginals':len(originals),'repetition':{phase:{key:sum(x.get('exactTextRepetition',{}).get(phase,{}).get(key,0)for x in out)for key in ['groupCount','excessCopies']}for phase in ['raw','admitted']}},indent=2))
