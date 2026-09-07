import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(path.join(root,'apps/desktop/package.json'));
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('tsx')]}));
const temporary=await mkdtemp(path.join(tmpdir(),'dn-reader-'));
try{
 await esbuild.build({entryPoints:[path.join(root,'packages/cloud-reader/tests/browser-fixture.tsx')],bundle:true,jsx:'automatic',platform:'browser',outfile:path.join(temporary,'fixture.js'),alias:{'react/jsx-runtime':require.resolve('react/jsx-runtime'),'react/jsx-dev-runtime':require.resolve('react/jsx-dev-runtime'),react:require.resolve('react'),'react-dom/client':require.resolve('react-dom/client')},define:{'process.env.NODE_ENV':'"development"'}});
 await writeFile(path.join(temporary,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><title>Controlled reader fixture</title></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
 const chrome=process.env.BROWSER_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const result=spawnSync(chrome,['--headless=new','--no-first-run','--disable-gpu','--disable-background-networking','--disable-extensions','--disable-component-update',`--user-data-dir=${path.join(temporary,'profile')}`,'--virtual-time-budget=10000','--dump-dom',`file://${path.join(temporary,'index.html')}`],{encoding:'utf8',timeout:60000,maxBuffer:5*1024*1024});
 if(result.error||result.status!==0||!result.stdout.includes('data-test-status="passed"'))throw new Error('Browser fixture failed: '+(result.error??result.stdout.slice(-2000))+' '+result.stderr.slice(-1500));
 console.log('PASS: browser renders typed notes, named speakers, selected summary/private preview, version selection, Trash, restore and stale-workspace response rejection. Synthetic fixture only.');
}finally{await rm(temporary,{recursive:true,force:true});}
