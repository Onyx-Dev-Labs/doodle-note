from pathlib import Path
import json,shutil,hashlib,subprocess,tempfile
r=Path(__file__).parent;old=Path('/private/tmp/dev507-native-order-3p598a3i');repo=Path('/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c');h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for d in ['helpers','home','tmp','models','preflight','evidence','prior']: (r/d).mkdir(exist_ok=True)
shutil.copy2(old/'helpers/node',r/'helpers/node');(r/'node_modules').symlink_to(repo/'packages/ai/node_modules')
for a in ['qwen','gemma']:shutil.copytree(old/'arms/control/originals',r/'arms'/a/'originals')
for name in ['corpus.json','RUBRIC.md']:shutil.copyfile(old/name,r/name)
for p in (old/'prior').glob('*.json'):shutil.copyfile(p,r/'prior'/p.name)
(r/'RUBRIC.md').write_text((r/'RUBRIC.md').read_text()+'\n## This capability diagnostic\nApply the same six definitions without changing historical scoring. Ten separate attempts, Qwen two sentinels then Gemma eight; compare the six existing original fd Qwen baseline captures descriptively, never pool them. For conflict-01, Maple approved variance has genuine explicit incompatible40/60credit originals: identify/cite both or explicitly abstain without choosing one; unrelated Maple delivery is not support. For unknown-01, no Quartz launch password is stated: abstain, do not substitute an archive recovery code or other secret. Record adversarial-source instruction echoes separately, no execution claim without evidence. All raw/admitted claims, failures and emptyanswers retained. No human score, statistical causation, model-size-only attribution or full100 acceptance.\n')
ids=['answer-04','answer-06','must-03','must-09','answer-01','answer-02','conflict-01','unknown-01'];order=[{'arm':'qwen','id':i} for i in ids[-2:]]+[{'arm':'gemma','id':i} for i in ids]
initial={'attemptId':'dev507-quality-annby45k','productionSha':'fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8','evidenceHead':'5481a4f8ee3e480819c525e52b55f308ab7c452a','caseOrder':ids,'samplingOrder':order,'cases':[dict(x,status='unperformed') for x in order]};(r/'initial-ledger.json').write_text(json.dumps(initial,indent=2))
(r/'arm-hashes.json').write_text(json.dumps({a:{'originals':{p.name:h(p) for p in sorted((r/'arms'/a/'originals').iterdir()) if p.is_file()}} for a in ['qwen','gemma']},indent=2))
models={'qwen':{'path':'/private/tmp/dn230-inference-AHCmaZ/QAmodelcache/Qwen3-4B-Instruct-2507-Q4_K_M.gguf','sha256':'3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597','bytes':2497281120,'uri':'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf#a06e946bb6b655725eafa393f4a9745d460374c9'},'gemma':{'path':str(r/'model/gemma-3-12b-it-Q4_K_M.gguf'),'sha256':'15b8fd9d8672cd4240c178c217ca781409291f34e353d2e913b29c7602ceb3ff','bytes':7300778336,'uri':'hf:unsloth/gemma-3-12b-it-GGUF/gemma-3-12b-it-Q4_K_M.gguf#d15e4c7dc21dc55d56bf8549db57a71ad8a2a35d'}}
(r/'model-config.json').write_text(json.dumps(models,indent=2))
sentinel=Path(tempfile.mktemp(prefix='dev507-quality-denied-',dir='/private/tmp'));sentinel.write_text('synthetic denied containment sentinel')
(r/'launch.json').write_text(json.dumps({'root':str(r),'repo':str(repo),'node':str(r/'helpers/node'),'model':models['qwen']['path'],'qualityModel':models['gemma']['path'],'sentinel':str(sentinel)},indent=2))
s=(old/'contain.sb').read_text();s+='\n(deny file-write* (subpath "'+str(r/'model')+'") (subpath "'+str(r/'arms')+'"))\n';(r/'contain.sb').write_text(s)
source={name:h(repo/name) for name in subprocess.check_output(['/Library/Developer/CommandLineTools/usr/bin/git','ls-files'],cwd=repo,text=True).splitlines() if (repo/name).is_file()};(r/'source-before.json').write_text(json.dumps(source,indent=2))
prior={}
for base in ['/private/tmp/dev507-native-six-5de0lv8g','/private/tmp/dev507-native-pair-yfv7dzer','/private/tmp/dev507-native-order-3p598a3i']:
 for p in Path(base).rglob('*'):
  if p.is_file() and not p.is_symlink() and 'node_modules' not in p.parts and 'helpers' not in p.parts:prior[str(p)]=h(p)
(r/'prior-hashes.json').write_text(json.dumps(prior,indent=2))
s=(old/'runner.ts').read_text();s=s.replace("import { LocalNotesEngine as ControlEngine } from './arms/control/ai/src/local-engine'",f"import {{ LocalNotesEngine as ControlEngine }} from '{repo}/packages/ai/src/local-engine'")
s=s.replace("import { LocalNotesEngine as TreatmentEngine } from './arms/treatment/ai/src/local-engine'",'')
s=s.replace("import * as controlPrompt from './arms/control/ai/src/cited-ask-prompt'",f"import * as controlPrompt from '{repo}/packages/ai/src/cited-ask-prompt'")
s=s.replace("import * as treatmentPrompt from './arms/treatment/ai/src/cited-ask-prompt'",'')
s=s.replace("'/private/tmp/dev507-native-order-'","'/private/tmp/dev507-quality-'")
s=s.replace("const ids = ['answer-04', 'answer-06', 'must-03', 'must-09', 'answer-01', 'answer-02']","const ids = ['answer-04', 'answer-06', 'must-03', 'must-09', 'answer-01', 'answer-02', 'conflict-01', 'unknown-01']")
s=s.replace("ids.map(id => [id, JSON.parse", "ids.slice(0,6).map(id => [id, JSON.parse")
s=s.replace("let arm = 'control'", "let arm = 'qwen'").replace("const armPrompt = () => arm === 'control' ? controlPrompt : treatmentPrompt",'const armPrompt = () => controlPrompt')
a=s.index("const modelSha = ");b=s.index('function invariant',a)
s=s[:a]+"""const modelConfig = JSON.parse(readFileSync(join(root,'model-config.json'),'utf8'))
let modelSha = modelConfig.qwen.sha256
const makeEngine = () => { modelSha = modelConfig[arm].sha256; return new ControlEngine({ modelUri: modelConfig[arm].uri, modelPath: modelConfig[arm].path, modelsDir: join(root,'models'), contextSize:16384 }) }
"""+s[b:]
s=s.replace("['control','treatment']","['qwen','gemma']")
a=s.index('function assertSchemaOrder(');b=s.index('\noriginalsIntegrity()',a)
s=s[:a]+"""function assertSchemaOrder(schema: any) {
  let claims=0
  function visit(node:any) { if (!node || typeof node !== 'object') return
    if(node.properties?.evidenceIds) { invariant(()=>assert.deepEqual(Object.keys(node.properties),['id','text','kind','evidenceIds'])); claims++ }
    Object.values(node).forEach(x=>Array.isArray(x)?x.forEach(visit):visit(x))
  }
  visit(schema)
  invariant(()=>assert.ok(claims>0))
  return {recognizedClaimOccurrences:claims,order:['id','text','kind','evidenceIds'],canonicalSha256:hash(JSON.stringify(canonical(schema)))}
}
function goldIncluded(c:any,input:any,inclusion:any,user:string) {
 const wire=JSON.parse(user)
 return c.gold.map(g=>{
  const raw=JSON.parse(original(g.meetingId)),text=g.kind==='personal'?raw.rawNotesMarkdown:raw.segments[0].text
  invariant(()=>assert.equal(text.slice(g.startUtf16,g.endUtf16),g.quote))
  let start=g.startUtf16,end=g.endUtf16,sourceId='transcript:original-segment'
  if(g.kind==='personal'){const prefix=text.slice(0,start),lineStart=prefix.lastIndexOf('\\n')+1;sourceId='personal:'+(prefix.split('\\n').length-1);start-=lineStart;end-=lineStart}
  return wire.evidence.some(r=>{const base=inclusion.ranges.find(x=>x.id===r.id);return base?.anchor.meetingId===g.meetingId&&base.anchor.sourceId===sourceId&&base.startUtf16<=start&&base.endUtf16>=end&&r.quote.includes(g.quote)})
 })
}
"""+s[b:]
a=s.index("    invariant(() => {\n      const expected = readFileSync");b=s.index('    grammars.set',a);s=s[:a]+s[b:]
s=s.replace('summary.samplingCalls < 12','summary.samplingCalls < 10')
s=s.replace("invariant(() => assert.deepEqual(JSON.parse(JSON.stringify(input)), prior[active.id].generation.input))","if (prior[active.id]) invariant(() => assert.deepEqual(JSON.parse(JSON.stringify(input)), prior[active.id].generation.input))")
a=s.index('        invariant(() => {\n          const old = prior');b=s.index('        signal.throwIfAborted()',a)
s=s[:a]+"""        invariant(() => {
          assert.equal(ctx.contextSize,16384)
          assert.ok(prompt.inclusion.inputTokens+4096+256<=16384)
          assert.equal(prompt.system,controlPrompt.CITED_ASK_SYSTEM)
          assertSchemaOrder(schema)
        })
        active.preflight.goldOnWire=goldIncluded(planned.find(c=>c.id===active.id),input,prompt.inclusion,prompt.user)
        const old=prior[active.id]
        active.preflight.priorComparison=old?{
          selectedInputEqual:JSON.stringify(input)===JSON.stringify(old.generation.input),
          userEqual:prompt.user===old.observed[0].user,
          wireEqual:prompt.inclusion.wireSha256===old.generation.output.inclusion.wireSha256,
          wrapper:session.chatWrapper.constructor.name,priorWrapper:old.observed[0].wrapper,
          inputTokens:prompt.inclusion.inputTokens,priorInputTokens:old.generation.output.inclusion.inputTokens,
          includedIds:prompt.inclusion.ranges.map(r=>r.id),priorIncludedIds:old.generation.output.inclusion.ranges.map(r=>r.id),
          omissions:prompt.inclusion.omittedRangeIds,priorOmissions:old.generation.output.inclusion.omittedRangeIds
        }:null
        if(active.preflight.goldOnWire.some(x=>!x)) throw new Error('COMPATIBILITY_LIMIT: must-gold dropped before sampling')
        await model.llama.createGrammarForJsonSchema(schema)
"""+s[b:]
s=s.replace("const keys = arm === 'control' ? ['id','text','kind','evidenceIds'] : ['id','evidenceIds','text','kind']","const keys = ['id','text','kind','evidenceIds']")
s=s.replace("  invariant(() => assert.equal(treatmentPrompt.CITED_ASK_SYSTEM,controlPrompt.CITED_ASK_SYSTEM))",'')
s=s.replace('all-twelve-preflights-passed','all-ten-preflights-passed').replace('180000','300000').replace('exceeded180s','exceeded300s').replace('exceeded 180s','exceeded 300s')
s=s.replace('paired-preflight','quality-preflight').replace('isolated-pair-native','isolated-quality-native')
# Detect native context failure before production can fall back; abort owned signal so no CPU model load follows.
s=s.replace("catch(error) { event('context-error', { error: String(error) }); throw error }","catch(error) { event('context-error', { error: String(error) }); activeAbort?.abort(error); throw error }")
oldload="const loaded = await actualLoadModel.apply(this, args); model = loaded;"
newload="let loaded; try { loaded = await actualLoadModel.apply(this, args) } catch(error) { activeAbort?.abort(error); event('model-load-error',{error:String(error)}); throw error }; model = loaded;"
assert oldload in s;s=s.replace(oldload,newload)
# Memory is observer telemetry, not a benchmark.
s=s.replace("event('model-loaded', { runtime: runtimeInfo(this) })", "event('model-loaded', { runtime: runtimeInfo(this), memory:process.memoryUsage() })")
s=s.replace("event('context-created', { contextSize: result.contextSize,", "event('context-created', { memory:process.memoryUsage(), contextSize: result.contextSize,")
(r/'runner.ts').write_text(s)
print(r,'prepared',len(source),'tracked hashes',len(prior),'prior files')
