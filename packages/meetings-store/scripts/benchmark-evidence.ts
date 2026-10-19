/** One fresh process per mode/size. Baseline is a git archive, never another worktree. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

const [sourceRootArg, mode, countArg, revision] = process.argv.slice(2);
if (!sourceRootArg || !['foundation-search','candidate-evidence'].includes(mode!) || !['1000','10000'].includes(countArg!) || !revision) throw Error('Usage: benchmark-evidence.ts <source repo root> foundation-search|candidate-evidence 1000|10000 <exact revision>');
const sourceRoot = resolve(sourceRootArg), count = Number(countArg);
const {SourceIndexClient} = await import(pathToFileURL(join(sourceRoot,'packages/meetings-store/src/source-index-client.ts')).href);
const {localSourceScope} = await import(pathToFileURL(join(sourceRoot,'packages/meetings-store/src/source-projection.ts')).href);
const root = mkdtempSync(join(tmpdir(),'dev507-performance-'));
const dir = join(root,'meetings'); mkdirSync(dir);
const body = 'Synthetic discussion of launch planning and budget allocation. Café 東京計画. '.repeat(4);
const queries = ['rarephrase','cafe','launch','budget','東京計画'];
for (let i=0;i<count;i++) writeFileSync(join(dir,`meeting-${String(i).padStart(5,'0')}.json`),JSON.stringify({
  id:`meeting-${String(i).padStart(5,'0')}`,title:`Synthetic meeting ${i}`,createdAt:new Date(i*100000).toISOString(),
  rawNotesMarkdown:'Personal planning notes\nFollow up',segments:Array.from({length:20},(_,j)=>({id:`s-${j}`,text:body+(i===0&&j===19?'rarephrase':''),speaker:'Synthetic speaker',channel:'mic',startMs:j*1000,endMs:j*1000+900,confidence:1}))
}));
const context={meetingsDir:dir,scope:localSourceScope(dir,true),authorized:true};
const worker = new Worker(`require(${JSON.stringify(fileURLToPath(import.meta.resolve('tsx/cjs')))}); require(${JSON.stringify(join(sourceRoot,'packages/meetings-store/src/source-index-worker.ts'))});`,{eval:true,workerData:{meetingsDir:dir,cacheDir:join(root,'cache')}});
const client=new SourceIndexClient(worker,()=>context);
const run = (query:string) => mode==='foundation-search' ? client.search(query) : client.retrieveEvidence({mode:'question',question:query,filters:{}});
const percentile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)];
let peakRss=process.memoryUsage().rss;
const memory=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss)},10);
try {
  const coldStart=performance.now(); await run('rarephrase'); const coldMs=performance.now()-coldStart;
  await run('launch'); // warmup excluded
  const delay=monitorEventLoopDelay({resolution:1});delay.enable();
  let ticks=0,checksum=0;const pcm=Float32Array.from({length:320},(_,i)=>Math.sin(i/10)*.05);
  // Separate synthetic capture file avoids intentionally mutating the requested evidence domain.
  // Same atomic-write load in both modes; no microphone or app recording process.
  const capture=setInterval(()=>{ticks++;for(const sample of pcm)checksum+=sample*sample;if(ticks%10===0){writeFileSync(join(root,'capture.tmp'),JSON.stringify({ticks,text:'synthetic capture only'}));renameSync(join(root,'capture.tmp'),join(root,'capture.json'));}},20);
  const samples:Array<{query:string;ms:number;status:string;selected?:number}>=[];
  await new Promise(r=>setTimeout(r,25));
  const start=performance.now();
  for(let i=0;i<20;i++){
    const query=queries[i%queries.length]!; const begin=performance.now();
    try{const result=await run(query);samples.push({query,ms:performance.now()-begin,status:mode==='foundation-search'?'search-complete':result.coverage.scanComplete?'scan-complete':'incomplete',selected:result.ranges?.length});}
    catch(e){samples.push({query,ms:performance.now()-begin,status:e instanceof Error?e.message:String(e)});}
  }
  const elapsedMs=performance.now()-start;clearInterval(capture);delay.disable();
  console.log(JSON.stringify({revision,mode,count,node:process.version,measuredAt:new Date().toISOString(),hardware:{os:`${process.platform} ${release()}`,arch:process.arch,cpu:cpus()[0]?.model,memoryGiB:totalmem()/2**30},method:'Identical deterministic 20-segment originals; separate fresh process/cache; cold + one warmup + 20 mixed queries; 20ms synthetic PCM callback and 200ms atomic write outside evidence domain. No native capture/model.',coldMs,queryP50Ms:percentile(samples.map(x=>x.ms),.5),queryP95Ms:percentile(samples.map(x=>x.ms),.95),mainLoopP95Ms:delay.percentile(95)/1e6,mainLoopMaxMs:delay.max/1e6,processPeakRssMiB:Math.max(peakRss,process.memoryUsage().rss)/2**20,resourceMaxRssMiB:process.resourceUsage().maxRSS/1024,captureTicks:ticks,checksum,elapsedMs,samples},null,2));
} finally {clearInterval(memory);await client.close();rmSync(root,{recursive:true,force:true});}
