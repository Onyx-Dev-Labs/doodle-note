import pathlib,subprocess,os,json,signal,sys,hashlib,stat,time
root=pathlib.Path(sys.argv[1]);cfg=json.loads((root/'launch.json').read_text());repo=pathlib.Path(cfg['repo']);model=pathlib.Path(cfg['model']);node=cfg['node']
sha=subprocess.check_output(['/Library/Developer/CommandLineTools/usr/bin/git','rev-parse','HEAD'],cwd=repo,text=True).strip();assert sha=='f7f43c7d8a898a61015650b44a218167c1dedf76';assert not subprocess.check_output(['/Library/Developer/CommandLineTools/usr/bin/git','status','--porcelain'],cwd=repo,text=True);cfg['sourceSha']='f7f43c7d8a898a61015650b44a218167c1dedf76'
frozen=json.loads((root/'freeze.json').read_text())
for name,expected in frozen['files'].items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected,name
for name,expected in json.loads((root/'source-before.json').read_text()).items():assert hashlib.sha256((repo/name).read_bytes()).hexdigest()==expected,name
models=json.loads((root/'model-config.json').read_text())
def model_record():
 records={}
 for key,expected in models.items():
  path=pathlib.Path(expected['path']);st=path.lstat();assert stat.S_ISREG(st.st_mode) and not path.is_symlink() and stat.S_IMODE(st.st_mode)==0o444 and st.st_size==expected['bytes']
  dig=hashlib.sha256()
  with path.open('rb') as f:
   for b in iter(lambda:f.read(1024*1024),b''):dig.update(b)
  assert dig.hexdigest()==expected['sha256']
  records[key]={'path':str(path),'mode':oct(stat.S_IMODE(st.st_mode)),'bytes':st.st_size,'sha256':dig.hexdigest(),'inode':st.st_ino,'mtimeNs':st.st_mtime_ns}
 return records
(root/'model-before.json').write_text(json.dumps(model_record(),indent=2))
cmd=['/usr/bin/sandbox-exec','-f',str(root/'contain.sb'),'-D','REPO='+str(repo),'-D','MODEL='+str(model),'-D','RUN='+str(root),'-D','NODE='+node,node,str(root/'runner.mjs'),str(root),str(root/'corpus.json'),str(model),cfg['sourceSha'],cfg['sentinel']]
env={'PATH':'/usr/bin:/bin','HOME':str(root/'home'),'CFFIXED_USER_HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'XDG_CACHE_HOME':str(root/'home/.cache')}
start=time.time()
with (root/'stdout.log').open('w') as out,(root/'stderr.log').open('w') as err:
 p=subprocess.Popen(cmd,cwd=root,env=env,stdout=out,stderr=err,start_new_session=True,close_fds=True)
 cfg.update({'argv':cmd,'environment':env,'pid':p.pid,'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'policySha256':hashlib.sha256((root/'contain.sb').read_bytes()).hexdigest(),'runnerSha256':hashlib.sha256((root/'runner.mjs').read_bytes()).hexdigest(),'observerSourceSha256':hashlib.sha256((root/'runner.ts').read_bytes()).hexdigest(),'launcherSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'outerDeadlineSeconds':3000});(root/'launch.json').write_text(json.dumps(cfg,indent=2))
 try:code=p.wait(timeout=3000)
 except subprocess.TimeoutExpired:
  (root/'outer-watchdog.json').write_text(json.dumps({'event':'50min outer deadline','action':'one SIGTERM then await30s, SIGKILL last resort','at':time.time()}));os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=30)
  except subprocess.TimeoutExpired:
   (root/'forced-termination.json').write_text(json.dumps({'cleanup':'UNQUALIFIED','signal':'SIGKILL','at':time.time()}));os.killpg(p.pid,signal.SIGKILL);p.wait()
  code=124
# Reconcile all eight rows even if startup or forced termination prevented runner finalization.
ledger=root/'summary.json';summary=json.loads(ledger.read_text()) if ledger.exists() else json.loads((root/'initial-ledger.json').read_text())
if code!=0:
 for row in summary['cases']:
  if row['status']=='running':row.update({'status':'forced/interrupted' if (root/'forced-termination.json').exists() else 'runner-failed','cleanup':'UNQUALIFIED'})
 summary['launcherExit']=code;ledger.write_text(json.dumps(summary,indent=2))
after=model_record();(root/'model-after.json').write_text(json.dumps(after,indent=2));assert after==json.loads((root/'model-before.json').read_text())
for name,expected in json.loads((root/'source-before.json').read_text()).items():assert hashlib.sha256((repo/name).read_bytes()).hexdigest()==expected,name
for name,expected in json.loads((root/'prior-hashes.json').read_text()).items():assert hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()==expected,name
for name,expected in frozen['files'].items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected,name
(root/'source-prior-freeze-integrity.json').write_text(json.dumps({'sourceUnchanged':True,'priorRootUnchanged':True,'frozenPlanRunnerArmsUnchanged':True},indent=2))
(root/'exit.json').write_text(json.dumps({'code':code,'elapsedSeconds':time.time()-start,'modelUnchanged':True,'forcedTermination':(root/'forced-termination.json').exists(),'nativeChildExited':p.poll() is not None},indent=2));print(root,code)
sys.exit(code)
