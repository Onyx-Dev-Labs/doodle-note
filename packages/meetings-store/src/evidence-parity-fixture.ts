/** Synthetic behavioral fixture for the frozen pre-optimization bundle contract. */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from './source-projection';
import { retrieveOriginalEvidence, normalizeEvidenceSelection } from './evidence-retrieval';
import type { EvidenceSelection } from './evidence-contract';

export function captureEvidenceParity() {
  const root=mkdtempSync(join(tmpdir(),'dev507-parity-'));
  const context={meetingsDir:root,scope:{libraryId:'synthetic-parity',accountId:null,workspaceId:null},authorized:true};
  try {
    const texts=['ΚΟΣΜΟΣ ΟΣ ΟΣΑ','Café Cafe\u0301 İSTANBUL ﬃ 𐐀𐐁','alpha beta alpha','alpha '+ 'x'.repeat(1594), 'alpha '+'🌳'.repeat(1594), 'alpha '+ 'x'.repeat(1595), '🌳'.repeat(2000)+' ΚΟΣΜΟΣ alpha ﬃ '+ 'x'.repeat(2000), 'unmatched '.repeat(500), 'ALPHA beta gamma', 'beta gamma'];
    for(let i=0;i<texts.length;i++)writeFileSync(join(root,`unicode-${i}.json`),JSON.stringify({id:`unicode-${i}`,title:`Synthetic ${i}`,createdAt:'2020-01-01T00:00:00Z',folderId:i%2?'odd':'even',rawNotesMarkdown:texts[i],segments:[{id:'segment',text:texts[i]}]}));
    for(let i=0;i<72;i++)writeFileSync(join(root,`tie-${String(i).padStart(3,'0')}.json`),JSON.stringify({id:`tie-${String(i).padStart(3,'0')}`,createdAt:'2026-01-01T00:00:00Z',rawNotesMarkdown:'alpha beta gamma',segments:[]}));
    const questions=['alpha','alpha alpha beta','"alpha beta" gamma','ΚΟΣΜΟΣ','ΟΣ','Cafe','İstanbul','ﬃ','𐐀𐐁','no-such-literal','alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho'];
    const selections:EvidenceSelection[]=[...questions.map(question=>({mode:'question' as const,question,filters:{}})),{mode:'question',question:'alpha',filters:{folderId:'even'}},{mode:'question',question:'alpha',filters:{dateBefore:'2021-01-01T00:00:00Z'}},{mode:'question',question:'alpha',filters:{},meetingIds:[]},{mode:'question',question:'alpha',filters:{},meetingIds:['unicode-6','unicode-0','unicode-6']},{mode:'linked-history',meetingIds:[]},{mode:'linked-history',meetingIds:['unicode-6','unicode-0','unicode-6']},{mode:'linked-history',meetingIds:['unicode-4','unicode-5','unicode-6','unicode-7'],topic:'alpha beta'},{mode:'linked-history',meetingIds:['unicode-4','unicode-5','unicode-6','unicode-7']}];
    return selections.map(input=>{
      const bundle=retrieveOriginalEvidence(context,input);
      const stable={...bundle,coverage:{...bundle.coverage,observedAt:''},manifest:{...bundle.manifest,pathBindingSha256:''}};
      return {selection:normalizeEvidenceSelection(input),bundleSha256:digest(JSON.stringify(stable)),ranges:bundle.ranges.map(r=>({id:r.id,meetingId:r.anchor.meetingId,sourceId:r.anchor.sourceId,start:r.startUtf16,end:r.endUtf16})),coverage:stable.coverage};
    });
  } finally {rmSync(root,{recursive:true,force:true});}
}
