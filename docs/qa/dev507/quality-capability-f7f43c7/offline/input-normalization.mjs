/** QA DTO comparison only. Omit undefined solely for contract-optional range.speaker. */
import assert from 'node:assert/strict';
export function normalizeCitedInput(value) {
 const seen=new Set();
 function visit(v,path) {
  if(v===null || typeof v==='string' || typeof v==='boolean') return v;
  if(typeof v==='number'){assert.ok(Number.isFinite(v),'nonfinite at '+path);return v;}
  assert.ok(v && typeof v==='object','non-JSON value at '+path);
  assert.ok(!seen.has(v),'cycle at '+path);seen.add(v);
  assert.equal(Object.getOwnPropertySymbols(v).length,0,'symbol key');
  let out;
  if(Array.isArray(v)){
   assert.deepEqual(Object.keys(v),Array.from({length:v.length},(_,i)=>String(i)),'sparse/extra array fields');
   out=v.map((x,i)=>visit(x,path+'.'+i));
  }else{
   assert.ok(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null,'nonplain object');
   out={};
   for(const [key,d] of Object.entries(Object.getOwnPropertyDescriptors(v))){
    assert.ok(d.enumerable && 'value' in d,'nondata/nonenumerable property');
    if(d.value===undefined && key==='speaker' && /^ranges\.\d+$/.test(path))continue;
    Object.defineProperty(out,key,{value:visit(d.value,path?path+'.'+key:key),enumerable:true,writable:true,configurable:true});
   }
  }
  seen.delete(v);return out;
 }
 return visit(value,'');
}
