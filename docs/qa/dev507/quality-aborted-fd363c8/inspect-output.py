"""Offline read-only display helper; never rewrites evidence or scores entailment."""
import sys,json,collections
from pathlib import Path
root=Path(sys.argv[1])
for label in sys.argv[2:]:
 d=json.loads((root/'evidence'/f'{label}.json').read_text())
 if 'record' not in d: continue
 print('\nCASE',label,d['record']['status'])
 o=d.get('generation',{}).get('output',{})
 try:raw=json.loads(o.get('rawJson',''))
 except Exception:print('UNPARSED',o);continue
 ranges={r['id']:r for r in o['inclusion']['ranges']}; admitted={c['id']:c for c in d.get('result',{}).get('snapshot',{}).get('claims',[])}
 print('STATUS',raw['status'])
 for c in raw['claims']:
  print(c['id'],c['kind'],repr(c['text']))
  for i in c['evidenceIds']:
   r=ranges[i];q=r['quote'];view=q if len(q)<300 else '\n'.join(l for l in q.splitlines() if 'archive:' in l or 'recovery code' in l)
   print('   REF',r['anchor']['meetingId'],r['anchor']['sourceId'],repr(view[:500]),'(full quote retained in evidence)')
  if c['id'] in admitted and admitted[c['id']]['text']!=c['text']:print('   ADMITTED',repr(admitted[c['id']]['text'][:400]))
 for kind,claims in [('raw',raw['claims']),('admitted',list(admitted.values()))]:
  dup=[{'text':t,'copies':n} for t,n in collections.Counter(c['text'].strip() for c in claims).items() if n>1]
  print(kind,'duplicates',json.dumps(dup,ensure_ascii=False))
