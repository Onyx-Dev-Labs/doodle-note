import pathlib,subprocess,os,json,signal,sys,hashlib,stat,time
root=pathlib.Path(sys.argv[1]);cfg=json.loads((root/'launch.json').read_text());repo=pathlib.Path(cfg['repo']);model=pathlib.Path(cfg['model']);node=cfg['node']
sha=subprocess.check_output(['/Library/Developer/CommandLineTools/usr/bin/git','rev-parse','HEAD'],cwd=repo,text=True).strip();cfg['sourceSha']=sha
subprocess.run(['pnpm','--filter','doodle-note-mcp','exec','esbuild',str(repo/'apps/desktop/scripts/dev507-native-evaluation.ts'),'--bundle','--platform=node','--format=esm','--external:node-llama-cpp','--outfile='+str(root/'runner.mjs')],cwd=repo,check=True)
cmd=['/usr/bin/sandbox-exec','-f',str(root/'contain.sb'),'-D','REPO='+str(repo),'-D','MODEL='+str(model),'-D','RUN='+str(root),'-D','NODE='+node,node,str(root/'runner.mjs'),str(root),str(root/'corpus.json'),str(model),sha,cfg['sentinel']]
env={'PATH':'/usr/bin:/bin','HOME':str(root/'home'),'CFFIXED_USER_HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'XDG_CACHE_HOME':str(root/'home/.cache')}
start=time.time()
with (root/'stdout.log').open('w') as out,(root/'stderr.log').open('w') as err:
 p=subprocess.Popen(cmd,cwd=root,env=env,stdout=out,stderr=err,start_new_session=True,close_fds=True)
 cfg.update({'argv':cmd,'environment':env,'pid':p.pid,'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'policySha256':hashlib.sha256((root/'contain.sb').read_bytes()).hexdigest(),'runnerSha256':hashlib.sha256((root/'runner.mjs').read_bytes()).hexdigest()});(root/'launch.json').write_text(json.dumps(cfg,indent=2))
 try:code=p.wait(timeout=2700)
 except subprocess.TimeoutExpired:
  os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=20)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  code=124
h=hashlib.sha256()
with model.open('rb') as f:
 for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
s=model.lstat();after={'path':str(model),'mode':oct(stat.S_IMODE(s.st_mode)),'bytes':s.st_size,'sha256':h.hexdigest(),'inode':s.st_ino,'mtimeNs':s.st_mtime_ns};(root/'model-after.json').write_text(json.dumps(after,indent=2));assert after==json.loads((root/'model-before.json').read_text())
(root/'exit.json').write_text(json.dumps({'code':code,'elapsedSeconds':time.time()-start,'modelUnchanged':True},indent=2));print(root,code)
sys.exit(code)
