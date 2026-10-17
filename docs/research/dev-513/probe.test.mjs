// Bounded synthetic fixture matrix; exercises the exact inline model, no app imports.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const html=readFileSync(new URL('./prototype.html',import.meta.url),'utf8');
const context=vm.createContext({crypto:webcrypto,atob,Uint8Array});
vm.runInContext(html.match(/<script id="probe-core">([\s\S]*?)<\/script>/)[1],context);
const {Probe}=context;
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const request={meetingMs:42000,actionUTC:'2026-10-17T23:40:00.000Z',dataURL:png};
function setup(){const data=new Map();const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};return {storage,data,store:new Probe.Store(storage)};}
test('deliberate allowlisted selection retains bytes, time, provenance; restart deselects',async()=>{
  const {store,storage}=setup();await assert.rejects(store.capture(request),/No allowed/);
  store.select(Probe.SOURCE);const {occurrence}=await store.capture(request);
  assert.equal(occurrence.meetingMs,42000);assert.equal(occurrence.provenance,'synthetic-render-v1');assert.equal(occurrence.derivedOCR,null);
  const restarted=new Probe.Store(storage);assert.equal(restarted.selected,null);
  assert.equal((await restarted.resolve(restarted.state.occurrences[0])).data,png);
});
test('exact-byte dedup preserves unique occurrences; deletion collects only last reference',async()=>{
  const {store}=setup();store.select(Probe.SOURCE);await store.capture(request);
  const second=await store.capture({...request,meetingMs:60000});assert.equal(second.duplicate,true);
  assert.equal(store.state.occurrences.length,2);assert.equal(Object.keys(store.state.originals).length,1);
  assert.notEqual(store.state.occurrences[0].id,second.occurrence.id);
  store.remove(1);assert.equal(Object.keys(store.state.originals).length,1);assert.equal(store.state.occurrences[0].meetingMs,60000);
  store.remove(2);assert.equal(Object.keys(store.state.originals).length,0);
});
test('different image bytes retain separate originals; no perceptual similarity threshold',async()=>{
  const {store}=setup();store.select(Probe.SOURCE);await store.capture(request);
  const generated='data:image/png;base64,'+readFileSync(new URL('./evidence/original-synthetic-slide.png',import.meta.url)).toString('base64');
  const result=await store.capture({...request,dataURL:generated});assert.equal(result.duplicate,false);
  assert.equal(Object.keys(store.state.originals).length,2);
});
test('cancel/denial/excluded source have no artifact; no broad fallback',async()=>{
  const {store,data}=setup();store.select(Probe.SOURCE);store.cancel();await assert.rejects(store.capture(request),/No allowed/);
  store.select('fixture-sensitive-v1');await assert.rejects(store.capture(request),/No allowed/);
  assert.equal(data.size,0);assert.equal(store.state.occurrences.length,0);
});
test('cancellation and selection changes fence async completion',async()=>{
  const {store,data}=setup();store.select(Probe.SOURCE);const pending=store.capture(request);store.cancel();
  assert.equal((await pending).cancelled,true);assert.equal(data.size,0);
  store.select(Probe.SOURCE);const changed=store.capture(request);store.select('fixture-sensitive-v1');
  assert.equal((await changed).cancelled,true);assert.equal(data.size,0);
});
test('missing and corrupt originals remain explicit after restart',async()=>{
  const {store,storage,data}=setup();store.select(Probe.SOURCE);const {occurrence}=await store.capture(request);
  store.loseOriginal(occurrence.imageHash);assert.equal((await new Probe.Store(storage).resolve(occurrence)).status,'missing');
  const raw=JSON.parse(data.get(Probe.KEY));raw.originals[occurrence.imageHash]='not an image';data.set(Probe.KEY,JSON.stringify(raw));
  assert.equal((await new Probe.Store(storage).resolve(occurrence)).status,'corrupt');
  assert.equal(new Probe.Store(storage).state.occurrences.length,1);
});
test('persistence failure publishes no occurrence or original in memory',async()=>{
  const {store,storage}=setup();storage.setItem=()=>{throw Error('simulated quota denied');};store.select(Probe.SOURCE);
  await assert.rejects(store.capture(request),/quota/);assert.equal(store.state.occurrences.length,0);assert.equal(Object.keys(store.state.originals).length,0);
});
test('malformed stored state fails closed and is not overwritten',()=>{
  const {storage,data}=setup();data.set(Probe.KEY,'{"version":99}');assert.throws(()=>new Probe.Store(storage),/Unreadable/);
  assert.equal(data.get(Probe.KEY),'{"version":99}');
});
test('invalid clock and overlapping capture are rejected',async()=>{
  const {store}=setup();store.select(Probe.SOURCE);await assert.rejects(store.capture({...request,meetingMs:NaN}),/timestamp/);
  const one=store.capture(request);await assert.rejects(store.capture(request),/already pending/);await one;
  assert.equal(store.state.occurrences.length,1);
});
test('known other-tab mutation blocks writes until restart',async()=>{
  const {store,data}=setup();store.select(Probe.SOURCE);store.blocked=true;
  await assert.rejects(store.capture(request),/Another tab/);assert.equal(data.size,0);
});
test('offline model has no network dependency; erase is scoped to its own key',async()=>{
  const {store,data}=setup();data.set('unrelated','preserve');store.select(Probe.SOURCE);await store.capture(request);store.erase();
  assert.equal(data.get('unrelated'),'preserve');assert.equal(store.state.occurrences.length,0);
  assert.match(html,/connect-src 'none'/);assert.doesNotMatch(html,/\b(fetch|XMLHttpRequest|WebSocket|getDisplayMedia|getUserMedia)\s*\(/);
});
