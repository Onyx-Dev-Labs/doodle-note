/** QA-only observer candidate. Not wired into or used for any native run. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
export async function observePrompt(session, actual, prompt, options, expected, record) {
  const history = session.getChatHistory();
  const state = session.chatWrapper.generateContextState({ chatHistory: [
    ...history, {type:'user',text:prompt}, {type:'model',response:[]}
  ] });
  const wireJson = state.contextText.toJSON();
  const tokens = state.contextText.tokenize(session.model.tokenizer);
  assert.equal(prompt,expected.user);
  assert.equal(hash(JSON.stringify(wireJson)),expected.wrapperSerializationSha256);
  assert.deepEqual(tokens,expected.tokens);
  assert.equal(hash(JSON.stringify(tokens)),expected.wireSha256);
  assert.equal(session.context.contextSize,expected.contextSize);
  assert.equal(options.grammar,expected.grammar);
  assert.equal(expected.grammarRuntime,session.model.llama);
  assert.equal(options.maxTokens,4096);
  assert.equal(options.temperature,0.3);
  assert.ok(tokens.length+4096+256<=session.context.contextSize);
  // Optional descriptive metadata never stands in for the required full wire.
  record({history,initialSystem:history.find(x=>x.type==='system')??null,wireJson,tokens});
  const result = await actual.call(session,prompt,options);
  record({responseText:result.responseText,stopReason:result.stopReason});
  return result;
}
