import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {observePrompt} from './observer-wire.mjs';
import {GemmaChatWrapper} from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/ai/node_modules/node-llama-cpp/dist/chatWrappers/GemmaChatWrapper.js';
import {QwenChatWrapper} from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/ai/node_modules/node-llama-cpp/dist/chatWrappers/QwenChatWrapper.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(wrapper,history){
 const user='synthetic untrusted original';const runtime={};const grammar={};
 const tokenizer=text=>Array.from(new TextEncoder().encode(text));
 const session={getChatHistory:()=>structuredClone(history),chatWrapper:wrapper,model:{tokenizer,llama:runtime},context:{contextSize:16384}};
 const wire=wrapper.generateContextState({chatHistory:[...history,{type:'user',text:user},{type:'model',response:[]}]}).contextText;const tokens=wire.tokenize(tokenizer);
 const expected={user,tokens,wrapperSerializationSha256:hash(JSON.stringify(wire.toJSON())),wireSha256:hash(JSON.stringify(tokens)),contextSize:16384,grammar,grammarRuntime:runtime};
 const controller=new AbortController();const options={grammar,signal:controller.signal,maxTokens:4096,temperature:0.3};return{session,expected,options,controller};
}
for(const [name,wrapper,history] of [['Gemma-empty',new GemmaChatWrapper(),[]],['Qwen-system',new QwenChatWrapper(),[{type:'system',text:'fixed rules'}]]])test(name+' full wire captured; arguments/result untouched',async()=>{
 const f=fixture(wrapper,history),records=[];const response={responseText:' synthetic raw bytes \n',stopReason:'stopGenerationTrigger'};
 const actual=async function(user,options){assert.equal(this,f.session);assert.equal(user,f.expected.user);assert.equal(options,f.options);return response};
 assert.equal(await observePrompt(f.session,actual,f.expected.user,f.options,f.expected,x=>records.push(x)),response);
 assert.deepEqual(records[0].history,history);assert.deepEqual(records[0].tokens,f.expected.tokens);assert.equal(records[0].initialSystem,history.length?records[0].history[0]:null);assert.equal(records[1].responseText,response.responseText);
});
test('OLD empty-history assertion is RED before forwarding',()=>{assert.throws(()=>assert.equal([][0].text,'rules'),TypeError)});
test('wire/grammar drift fails before forwarding rather than skipping accounting',async()=>{
 const f=fixture(new GemmaChatWrapper(),[]);let called=0;const actual=async()=>{called++;return{}};
 for(const changed of [{...f.expected,tokens:[1]},{...f.expected,wireSha256:'bad'},{...f.expected,wrapperSerializationSha256:'bad'},{...f.expected,grammar:{}},{...f.expected,grammarRuntime:{}}])await assert.rejects(observePrompt(f.session,actual,f.expected.user,f.options,changed,()=>{}));
 assert.equal(called,0);
});
test('native error and cancellation reason propagate with exact signal/options',async()=>{
 const f=fixture(new GemmaChatWrapper(),[]),error=new Error('same error');
 await assert.rejects(observePrompt(f.session,async()=>{throw error},f.expected.user,f.options,f.expected,()=>{}),e=>e===error);
 const work=observePrompt(f.session,async function(user,options){assert.equal(options,f.options);await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))},f.expected.user,f.options,f.expected,()=>{});
 f.controller.abort(error);await assert.rejects(work,e=>e===error);
});
