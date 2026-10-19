from pathlib import Path
import json,gzip,hashlib,shutil
r=Path(__file__).parent;repo=Path(json.loads((r/'launch.json').read_text())['repo']);dest=repo/'docs/qa/dev507/native-order-fd363c8';dest.mkdir(exist_ok=False)
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def gz(name,b):(dest/name).write_bytes(gzip.compress(b,mtime=0))
def jsonl(name,records):gz(name,b''.join((json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n').encode() for x in records))
s=json.loads((r/'summary.json').read_text())
jsonl('evidence.jsonl.gz',[json.loads((r/'evidence'/f"{x['arm']}-{x['id']}.json").read_text()) for x in s['cases']])
jsonl('preflight.jsonl.gz',[json.loads((r/'preflight'/f"{x['arm']}-{x['id']}.json").read_text()) for x in s['cases']])
jsonl('originals.jsonl.gz',[{'path':str(p.relative_to(r/'arms/control/originals')),'sha256':h(p),'rawUtf8':p.read_text()} for p in sorted((r/'arms/control/originals').iterdir()) if p.is_file()])
# Executed QA evidence only: no variant is installed in production sources.
jsonl('executed-arm-sources.jsonl.gz',[{'path':str(p.relative_to(r)),'sha256':h(p),'rawUtf8':p.read_text()} for a in ['control','treatment'] for p in sorted((r/'arms'/a/'ai/src').rglob('*')) if p.is_file()])
jsonl('setup-probe-and-grammars.jsonl.gz',[{'path':str(p.relative_to(r/'setup')),'sha256':h(p),'rawUtf8':p.read_text()} for p in sorted((r/'setup').rglob('*')) if p.is_file()])
for name in ['runner.mjs','claim-source-pairs.json','arm-hashes.json','source-before.json','prior-hashes.json','freeze.json','events.json']:gz(name+'.gz',(r/name).read_bytes())
for name in ['PLAN.md','RUBRIC.md','initial-ledger.json','runner.ts','build-runner.py','launch.py','contain.sb','treatment.diff','launch.json','summary.json','model-before.json','model-after.json','exit.json','source-prior-freeze-integrity.json','original-integrity.json','process-exit-proof.json','offline-verification.json','agent-inspection.json','verify-artifacts.py','collect-inspection.py','inspect-output.py','annotate.py','package.py']:shutil.copyfile(r/name,dest/name)
for name in ['stdout','stderr']:shutil.copyfile(r/(name+'.log'),dest/(name+'.txt'))
shutil.copyfile(r/'setup/probe.log',dest/'setup-probe.txt')
provenance={'rawRoot':str(r),'productionSha':'fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8','evidenceStartingHead':'c1fbb2e0a9d548f8d466229853d83a7d5ec71597','freezeSha256':h(r/'freeze.json'),'runnerSha256':h(r/'runner.mjs'),'observerSourceSha256':h(r/'runner.ts'),'launcherSha256':h(r/'launch.py'),'treatmentDiffSha256':h(r/'treatment.diff'),'qualitativeRubricSha256':h(r/'RUBRIC.md'),'corpusSha256':'0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2','frozen100RubricSha256':'782d8ac7def0d49073a7b5a304d6204761f2f9da05a6418fd2f597c800bc5777','prior79PacketSha256':'03099a2de708a36bdeff6d4930bbbaa7e83e944f88a5cd25a97ab2d6a142adcb','priorSixPacketSha256':'6c6c208882c8750ee861c04053b6d41c089c4d80862503f6bf8baf351125401d','priorRelevancePairPacketSha256':'1196ff4c1a4bd61e714185e3b45b1234fe12a7958861060c8be6a46142d9765c','offlineResearch':'/tmp/dev507-order-research-si69gd74/REPORT.md','offlineResearchSha256':h(r/'setup/research-REPORT.md'),'decision':'Mixed; stop order/prompt route under predeclared criterion. No adoption/wider qualification proposed. Parent owns next direction.','productionGate':'OFF','syntheticOriginals':701,'canonicalMarker':1,'modelCopied':False,'evidencePacketSha256':h(dest/'evidence.jsonl.gz'),'claimPairsSha256':h(dest/'claim-source-pairs.json.gz'),'notes':'Executed QA-only overlay archived as diagnostic provenance, not a production variant patch. No seed added; no causal/generalization claim, human score or frozen100 acceptance. All prior attempts remain separate.'}
(dest/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(dest);print(json.dumps({k:provenance[k] for k in ['evidencePacketSha256','claimPairsSha256','freezeSha256','runnerSha256']},indent=2))
