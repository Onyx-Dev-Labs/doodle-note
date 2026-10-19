from pathlib import Path
import json,hashlib,shutil,tempfile,subprocess,difflib,os
repo=Path('/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c');old=Path('/private/tmp/dev507-quality-successor-5ks880sv');qa=Path(__file__).parent;r=Path(tempfile.mkdtemp(prefix='dev507-quality-third-',dir='/private/tmp'));Path('/private/tmp/dev507-third-root.txt').write_text(str(r));h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert json.loads((old/'exit.json').read_text())['nativeChildExited'];assert json.loads((old/'source-prior-freeze-integrity.json').read_text())=={'sourceUnchanged':True,'priorRootUnchanged':True,'frozenPlanRunnerArmsUnchanged':True}
pid=json.loads((old/'launch.json').read_text())['pid']
try:os.kill(pid,0);raise AssertionError('old native PID still exists')
except ProcessLookupError:pass
for d in ['helpers','home','tmp','models','preflight','evidence']:(r/d).mkdir()
for d in ['arms','prior','baseline-gemma','review']:shutil.copytree(old/d,r/d)
shutil.copy2(old/'helpers/node',r/'helpers/node');(r/'node_modules').symlink_to(repo/'packages/ai/node_modules')
for n in ['arm-hashes.json','corpus.json','model-config.json','source-before.json','observer-wire.mjs','launch.py','verify-setup.py'] :shutil.copyfile(old/n,r/n)
shutil.copyfile(qa/'runner-candidate.ts',r/'runner.ts');shutil.copyfile(qa/'input-normalization.mjs',r/'input-normalization.mjs')
shutil.copytree(qa,r/'offline',ignore=shutil.ignore_patterns('setup-third.py'))
s=(old/'contain.sb').read_text().replace(str(old/'arms'),str(r/'arms'));(r/'contain.sb').write_text(s)
ledger=json.loads((old/'initial-ledger.json').read_text());ledger['attemptId']=r.name;ledger['lineage']['secondRoot']=str(old);ledger['lineage']['secondActualNativeGenerations']=0;ledger['lineage']['secondQaPreGenerationFailures']=1;ledger['lineage']['secondUnperformed']=7;ledger['lineage']['qaAttempt']=3;(r/'initial-ledger.json').write_text(json.dumps(ledger,indent=2))
sentinel=Path(tempfile.mktemp(prefix='dev507-third-denied-',dir='/private/tmp'));sentinel.write_text('synthetic denied containment sentinel');cfg=json.loads((old/'launch.json').read_text());(r/'launch.json').write_text(json.dumps({'root':str(r),'repo':str(repo),'node':str(r/'helpers/node'),'model':cfg['model'],'sentinel':str(sentinel)},indent=2))
prior=json.loads((old/'prior-hashes.json').read_text())
for p in old.rglob('*'):
 if p.is_file() and not p.is_symlink() and not any(x in p.parts for x in ['node_modules','helpers']):prior[str(p)]=h(p)
(r/'prior-hashes.json').write_text(json.dumps(prior,indent=2))
(r/'runner-diff.patch').write_text(''.join(difflib.unified_diff((old/'runner.ts').read_text().splitlines(True),(r/'runner.ts').read_text().splitlines(True),fromfile='second-frozen/runner.ts',tofile='third-candidate/runner.ts')))
(r/'PLAN.md').write_text((old/'PLAN.md').read_text()+'''\n## Third QA attempt, explicit predecessor failure\nSecond root /private/tmp/dev507-quality-successor-5ks880sv remains immutable: all8 full-system preflights passed, zero native calls/observer entries, first sampling admission failed on QA own-property comparison speaker:undefined versus omitted persisted key;7unperformed. Cleanup8models/8contexts, exit0 stopped-reason, fullmodel/source/prior/original integrity passed. New third attempt replaces only input guard comparison with strict JSON DTO normalization: undefined omitted only at ranges[n].speaker; reject other undefined/nonfinite/BigInt/functions/symbols/nonplain objects/accessors/sparse arrays. All defined data/order remain exact. Prior-input comparison uses the same safe normalizer instead of unconstrained JSON stringify. No production or other QA generation semantics change.\n\nBefore model load, full eight-fixture offline QA integration used actual MainCitedAskService/original projection, actual Gemma wrapper serialization, captured-token oracle and explicitly fake underlying response. OLD full guard path fails; FIX8 pass plus13 drift/error controls and3 normalization groups. Fake outputs are not native evaluation entries. Reviewed observer exact bytes unchanged. Source/harness copies and diff retained. All8 fresh native preflights still required, original stop rules unchanged; no adaptive repair within this freeze.\n''')
(r/'RUBRIC.md').write_bytes((old/'RUBRIC.md').read_bytes());shutil.copyfile(__file__,r/'setup.py')
(r/'predecessor-cleanup.json').write_text(json.dumps({'root':str(old),'pid':pid,'pidAbsent':True,'nativeGenerations':0,'observerEntries':0,'modelPrePostEqual':json.loads((old/'model-before.json').read_text())==json.loads((old/'model-after.json').read_text()),'exit':json.loads((old/'exit.json').read_text())},indent=2))
print(r)
