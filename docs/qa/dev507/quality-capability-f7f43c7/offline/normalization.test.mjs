import assert from 'node:assert/strict';import{test}from'node:test';import{readFileSync}from'node:fs';import{normalizeCitedInput as norm}from'./input-normalization.mjs';
const base=JSON.parse(readFileSync('/private/tmp/dev507-quality-successor-5ks880sv/preflight/gemma-answer-04.json')).preflight.input;
const live=()=>({...structuredClone(base),ranges:base.ranges.map(r=>({speaker:undefined,...structuredClone(r)}))});
test('exact captured input with faithful live undefined reproduces OLD failure and normalized equality',()=>{const x=live();assert.throws(()=>assert.deepEqual(x,base));assert.deepEqual(norm(x),base)});
test('factual/structural changes rejected',()=>{
 const mutations=[x=>x.ranges[0].speaker='Alice',x=>x.question+='?',x=>x.ranges[0].quote+='changed',x=>x.ranges[0].id+='x',x=>x.ranges[0].startUtf16++,x=>x.ranges[0].endUtf16++,x=>x.ranges[0].anchor.accountId='other',x=>x.ranges[0].anchor.workspaceId='other',x=>x.ranges.reverse(),x=>x.coverage+=' ',x=>x.terms.reverse(),x=>x.ranges[0].title+='changed',x=>x.ranges[0].occurredAt='2026-01-01'];
 for(const change of mutations){const x=live();change(x);assert.throws(()=>assert.deepEqual(norm(x),base))}
 const defined=live();defined.ranges[0].speaker='Alice';const missing=structuredClone(defined);delete missing.ranges[0].speaker;assert.throws(()=>assert.deepEqual(norm(missing),norm(defined)));
});
test('invalid non-JSON values never silently disappear',()=>{for(const bad of [NaN,Infinity,-Infinity,1n,()=>{},Symbol('x'),new Date(),new Map()]){const x=live();x.ranges[0].speaker=bad;assert.throws(()=>norm(x))}const x=live();x.context=undefined;assert.throws(()=>norm(x));const y=live();y.ranges[0].quote=undefined;assert.throws(()=>norm(y));const z=live();z.terms=[,];assert.throws(()=>norm(z))});
