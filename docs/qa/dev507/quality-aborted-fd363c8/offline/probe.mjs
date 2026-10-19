import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LlamaChatSession} from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/ai/node_modules/node-llama-cpp/dist/evaluator/LlamaChatSession/LlamaChatSession.js';
import {GemmaChatWrapper} from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/ai/node_modules/node-llama-cpp/dist/chatWrappers/GemmaChatWrapper.js';
import {QwenChatWrapper} from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/ai/node_modules/node-llama-cpp/dist/chatWrappers/QwenChatWrapper.js';
const root='/private/tmp/dev507-quality-annby45k';
const promptSource=readFileSync('/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/ai/src/cited-ask-prompt.ts','utf8');
const system=promptSource.split('export const CITED_ASK_SYSTEM = `')[1].split('`;')[0];
const prepared=JSON.parse(readFileSync(root+'/preflight/gemma-answer-04.json','utf8')).preflight;
assert.equal(system,prepared.prompt.system);
const user=prepared.prompt.user;
const sha=x=>createHash('sha256').update(x).digest('hex');
const record={note:'Actual pinned LlamaChatSession constructor/getChatHistory + actual pure wrapper, with LlamaChat native dependency explicitly stubbed and native/runtime import blocker. No model loaded, no inference, no native tokenizer claim.',cases:[]};
for(const [name,wrapper] of [['gemma',new GemmaChatWrapper()],['qwen',new QwenChatWrapper()]]){
 const session=new LlamaChatSession({contextSequence:{disposed:false},chatWrapper:wrapper,systemPrompt:system});
 const history=session.getChatHistory();
 const full=wrapper.generateContextState({chatHistory:[...history,{type:'user',text:user},{type:'model',response:[]}]}).contextText;
 const serialized=JSON.stringify(full.toJSON());
 let oldObserverError=null;try{assert.equal(history[0].text,system)}catch(e){oldObserverError=String(e)}
 const hasSystem=serialized.includes(system.replaceAll('\n','\\n'));
 if(name==='gemma'){assert.deepEqual(history,[]);assert.match(oldObserverError,/Cannot read properties of undefined/);assert.equal(hasSystem,false)}
 else{assert.equal(history[0].text,system);assert.equal(oldObserverError,null);assert.equal(hasSystem,true)}
 record.cases.push({name,history,supportsSystemMessages:wrapper.settings.supportsSystemMessages,serializedWire:full.toJSON(),serializedWireSha256:sha(serialized),containsSystemPrompt:hasSystem,oldObserverError});
 session.dispose();
}
writeFileSync(root+'/offline/diagnosis.json',JSON.stringify(record,null,2)+'\n');
console.log('PASS: actual session constructor omits supplied system on Gemma default; Qwen retains it. OLD observer Gemma RED/Qwen GREEN. Native/runtime imports blocked; no inference.');
