"""Offline exact boundary/claim pairing; no native imports or entailment inference."""
import json,hashlib,collections,gzip
from pathlib import Path
r=Path(__file__).parent
s=json.loads((r/'summary.json').read_text());assert s.get('endedAt') and len(s['cases'])==12
out=[]; originals={}
for row in s['cases']:
 label=row['arm']+'-'+row['id'];p=r/'evidence'/f'{label}.json'
 if not p.exists():out.append({'arm':row['arm'],'id':row['id'],'record':row,'claims':[]});continue
 d=json.loads(p.read_text());o=d.get('generation',{}).get('output',{})
 try:raw=json.loads(o.get('rawJson',''))
 except (ValueError,TypeError):raw=None
 ranges={x['id']:x for x in o.get('inclusion',{}).get('ranges',[])}
 admitted={c['id']:c for c in d.get('result',{}).get('snapshot',{}).get('claims',[])}
 paired=[]
 for c in (raw or {}).get('claims',[]):
  cited=[]
  for i in c['evidenceIds']:
   x=ranges[i];mid=x['anchor']['meetingId'];path=r/'arms'/row['arm']/'originals'/f'{mid}.json';b=path.read_bytes()
   originals[mid]={'id':mid,'sha256':hashlib.sha256(b).hexdigest(),'rawUtf8':b.decode()}
   cited.append({'range':x,'originalPath':str(path),'originalSha256':hashlib.sha256(b).hexdigest()})
  paired.append({'raw':c,'admitted':admitted.get(c['id']),'citedOriginals':cited})
 repetitions={}
 for phase,claims in [('raw',(raw or {}).get('claims',[])),('admitted',list(admitted.values()))]:
  by=collections.defaultdict(list)
  for c in claims:by[c['text'].strip()].append(c['id'])
  groups=[{'text':text,'ids':ids,'excessCopies':len(ids)-1} for text,ids in by.items() if len(ids)>1]
  repetitions[phase]={'groups':groups,'groupCount':len(groups),'excessCopies':sum(x['excessCopies'] for x in groups)}
 out.append({'arm':row['arm'],'id':row['id'],'question':d.get('question'),'record':row,'rawStatus':(raw or {}).get('status'),'admittedStatus':d.get('result',{}).get('snapshot',{}).get('status'),'claims':paired,'exactTextRepetition':repetitions})
(r/'claim-source-pairs.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
with gzip.GzipFile(filename=str(r/'cited-originals.jsonl.gz'),mode='wb',mtime=0) as f:
 for key in sorted(originals):f.write((json.dumps(originals[key],ensure_ascii=False,separators=(',',':'))+'\n').encode())
print(json.dumps({'cases':len(out),'rawClaims':sum(len(x['claims']) for x in out),'citedOriginals':len(originals),'repetitionByArm':{a:{phase:{key:sum(x.get('exactTextRepetition',{}).get(phase,{}).get(key,0) for x in out if x['arm']==a) for key in ['groupCount','excessCopies']} for phase in ['raw','admitted']} for a in ['control','treatment']}},indent=2))
