/** One bounded diagnostic, same synthetic 10k fixture as benchmark-evidence.ts. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { execFileSync } from 'node:child_process';
import { DerivedSourceIndex } from '../src/derived-index';
import { localSourceScope, changedSourceFiles, resolveOriginalSource } from '../src/source-projection';
import { scanEvidenceSources, selectOriginalEvidence, validateOriginalEvidence } from '../src/evidence-retrieval';
const out=process.argv[2];if(!out)throw Error('Pass an output directory');mkdirSync(out,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'dev507-cost-')),dir=join(root,'meetings');mkdirSync(dir);
const body='Synthetic discussion of launch planning and budget allocation. Café 東京計画. '.repeat(4);
for(let i=0;i<10000;i++)writeFileSync(join(dir,`meeting-${String(i).padStart(5,'0')}.json`),JSON.stringify({id:`meeting-${String(i).padStart(5,'0')}`,title:`Synthetic meeting ${i}`,createdAt:new Date(i*100000).toISOString(),rawNotesMarkdown:'Personal planning notes\nFollow up',segments:Array.from({length:20},(_,j)=>({id:`s-${j}`,text:body+(i===0&&j===19?'rarephrase':''),speaker:'Synthetic speaker',channel:'mic',startMs:j*1000,endMs:j*1000+900,confidence:1}))}));
const context={meetingsDir:dir,scope:localSourceScope(dir,true),authorized:true};
const selection={mode:'question' as const,question:'launch',filters:{}};
const index=new DerivedSourceIndex(join(root,'cache'));const session=new Session();session.connect();
const phases=[];
function time<T>(name:string,fn:()=>T):T{const cpu=process.cpuUsage(),rss=process.memoryUsage().rss,start=performance.now();const result=fn();const use=process.cpuUsage(cpu);phases.push({name,wallMs:performance.now()-start,cpuUserMs:use.user/1000,cpuSystemMs:use.system/1000,rssBeforeMiB:rss/2**20,rssAfterMiB:process.memoryUsage().rss/2**20});return result;}
try{
  time('cold-full-retrieval-and-index',()=>index.retrieveEvidence(context,selection));
  const snapshot=time('warm-full-original-scan-projection-hash',()=>scanEvidenceSources(context,selection,()=>{}));
  time('warm-index-reconcile',()=> (index as any).reconcile(context,snapshot,()=>{}));
  await session.post('Profiler.enable');await session.post('Profiler.setSamplingInterval',{interval:1000});await session.post('Profiler.start');
  const bundle=time('ranking-range-construction-manifest-and-final-stat-fence',()=>selectOriginalEvidence(context,selection,snapshot));
  const {profile}=await session.post('Profiler.stop');writeFileSync(join(out,'ranking.cpuprofile'),JSON.stringify(profile));
  time('standalone-final-stat-fence',()=>changedSourceFiles(snapshot,context));
  time('validate-manifest-full-rescan-and-rank',()=>validateOriginalEvidence(context,bundle.manifest));
  time('resolve-all-24-selected-original-ranges',()=>bundle.ranges.map(r=>resolveOriginalSource(context,r.anchor)));
  const nodes=new Map(profile.nodes.map(n=>[n.id,n]));const self=new Map<number,number>();for(let i=0;i<(profile.samples?.length??0);i++){const id=profile.samples![i]!;self.set(id,(self.get(id)??0)+(profile.timeDeltas?.[i]??1000));}
  const top=[...self].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([id,us])=>({selfMs:us/1000,...nodes.get(id)?.callFrame}));
  const report={revision:execFileSync('/Library/Developer/CommandLineTools/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,measuredAt:new Date().toISOString(),fixture:'Same deterministic 10k x20 segments as benchmark-evidence.ts, regenerated after benchmark cleanup. One bounded diagnostic, no model running.',originals:10000,passages:snapshot.documents.reduce((n,d)=>n+d.passages.length,0),candidates:bundle.coverage.candidateWindowCount,selected:bundle.ranges.length,phases,top,staticServiceCallAccounting:'Successful shared run: 4 complete scans/rankings (retrieve, pre-inference manifest validate, validate current retrieval, final manifest validate), selected range resolution before and after generation. Home admission adds 2 complete scans/rankings and prompt range resolution. Each full validation deliberately rereads current originals; these counts are inspected control flow, not native timing.'};
  writeFileSync(join(out,'profile.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{session.disconnect();index.close();rmSync(root,{recursive:true,force:true});}
