import { registerHooks } from 'node:module';
registerHooks({load(url,context,nextLoad) {
 if(url.endsWith('/evaluator/LlamaChat/LlamaChat.js')) return {format:'module',shortCircuit:true,source:`export class LlamaChat {constructor({chatWrapper,contextSequence}) {this.chatWrapper=chatWrapper;this.sequence=contextSequence;this.onDispose={createListener:()=>()=>{}}} dispose() {}}`};
 if(url.endsWith('/evaluator/LlamaChatSession/utils/LlamaChatSessionPromptCompletionEngine.js')) return {format:'module',shortCircuit:true,source:'export class LlamaChatSessionPromptCompletionEngine {}'};
 if(url.endsWith('/bindings/types.js')) return nextLoad(url,context); // inspected pure enums/helpers only; no imports
 if(url.endsWith('.node')||/node-llama-cpp\/dist\/(index|bindings)\b/.test(url)||(/node-llama-cpp\/dist\/evaluator\//.test(url)&&!url.endsWith('/evaluator/LlamaChatSession/LlamaChatSession.js'))) throw Error('Forbidden native/runtime import: '+url);
 return nextLoad(url,context);
}});
