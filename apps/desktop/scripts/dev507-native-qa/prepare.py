import pathlib,tempfile,os,shutil,json,hashlib,subprocess,stat
repo=pathlib.Path.cwd();root=pathlib.Path(tempfile.mkdtemp(prefix='dev507-native-',dir='/private/tmp'))
for d in ['home','tmp','evidence','models','helpers']: (root/d).mkdir(mode=0o700)
model=pathlib.Path('/private/tmp/dn230-inference-AHCmaZ/QAmodelcache/Qwen3-4B-Instruct-2507-Q4_K_M.gguf')
def verify():
 s=model.lstat();assert stat.S_ISREG(s.st_mode) and not model.is_symlink() and stat.S_IMODE(s.st_mode)==0o444 and s.st_size==2497281120
 h=hashlib.sha256()
 with model.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 assert h.hexdigest()=='3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597'
 return {'path':str(model),'mode':oct(stat.S_IMODE(s.st_mode)),'bytes':s.st_size,'sha256':h.hexdigest(),'inode':s.st_ino,'mtimeNs':s.st_mtime_ns}
(root/'model-before.json').write_text(json.dumps(verify(),indent=2))
node=pathlib.Path(shutil.which('node')).resolve();shutil.copy2(node,root/'helpers/node')
os.symlink(repo/'packages/ai/node_modules',root/'node_modules')
shutil.copyfile(repo/'docs/qa/dev507/quality-corpus-v1.json',root/'corpus.json')
sentinel=pathlib.Path(tempfile.mkstemp(prefix='dev507-denied-',dir='/private/tmp')[1]);sentinel.write_text('synthetic outside-root sentinel only')
# All user files denied by default. Read access is only this isolated checkout,
# exact approved model, OS runtimes and the fresh root. No profile/devices/accounts.
policy='''(version 1)
(allow default)
(deny network*)
(deny file-read* file-write*)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/Library/Apple") (subpath "/private/var/db/timezone") (literal "/private/etc/localtime") (literal "/private/etc/passwd") (literal "/private/etc/protocols") (literal "/private/etc/services") (literal "/private/etc/ssl/openssl.cnf") (literal "/dev/random") (literal "/dev/urandom"))
(allow file-read* file-map-executable (subpath (param "REPO")))
(allow file-read* (literal (param "MODEL")))
(allow file-read* file-write* file-map-executable (subpath (param "RUN")))
(allow file-read* file-write-data (literal "/dev/null") (literal "/dev/zero") (subpath "/dev/fd"))
(deny process-exec)
(allow process-exec (literal (param "NODE")))
(deny mach-lookup)
(allow mach-lookup (global-name "com.apple.MTLCompilerService") (global-name "com.apple.logd") (global-name "com.apple.logd.events") (global-name "com.apple.system.logger") (global-name "com.apple.bsd.dirhelper"))
(deny user-preference-read user-preference-write)
(deny appleevent-send)
'''
(root/'contain.sb').write_text(policy)
sha=subprocess.check_output(['/Library/Developer/CommandLineTools/usr/bin/git','rev-parse','HEAD'],text=True).strip()
config={'root':str(root),'repo':str(repo),'model':str(model),'node':str(root/'helpers/node'),'sentinel':str(sentinel),'sourceSha':sha}
(root/'launch.json').write_text(json.dumps(config,indent=2))
(repo/'.superpowers/sdd/2026-10-18-dev507-cited-ask/native-root.txt').write_text(str(root))
print(root)
