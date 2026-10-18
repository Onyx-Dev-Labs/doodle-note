from pathlib import Path
r=Path(__file__).parent;old=Path('/private/tmp/dev507-native-pair-yfv7dzer');s=(old/'runner.ts').read_text().replace('dev507-native-pair-','dev507-native-order-')
needle='originalsIntegrity()\nlet active:'
helper='''function canonical(value: any): any {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value
}
function assertSchemaOrder(schema: any) {
  const baseline = prior[active.id].grammar[0].schema
  const expected = JSON.parse(readFileSync(join(root, 'setup/grammars', active.id + '-' + arm + '.schema.json'), 'utf8'))
  const oldKeys = ['id','text','kind','evidenceIds'], newKeys = ['id','evidenceIds','text','kind']
  let claims = 0
  function visit(a: any, b: any, path = 'schema') {
    if (Array.isArray(b)) { assert.ok(Array.isArray(a)); assert.equal(a.length,b.length); b.forEach((v,i)=>visit(a[i],v,path+'.'+i)); return }
    if (b && typeof b === 'object') {
      const keys = Object.keys(b), isClaim = path.endsWith('.properties') && JSON.stringify(keys) === JSON.stringify(oldKeys)
      assert.deepEqual(Object.keys(a), isClaim && arm === 'treatment' ? newKeys : keys, path)
      if (isClaim) claims++
      for (const k of keys) visit(a[k],b[k],path+'.'+k)
    } else assert.deepEqual(a,b,path)
  }
  invariant(() => {
    assert.deepEqual(canonical(schema),canonical(baseline))
    visit(schema,baseline)
    assert.equal(claims,5)
    assert.equal(JSON.stringify(schema),JSON.stringify(expected))
  })
  return { recognizedClaimOccurrences: claims, order: arm === 'treatment' ? newKeys : oldKeys, canonicalSha256: hash(JSON.stringify(canonical(schema))) }
}
originalsIntegrity()
let active:'''
assert needle in s;s=s.replace(needle,helper)
s=s.replace("Llama.prototype.loadModel = async function(...args) { const loaded", "Llama.prototype.loadModel = async function(...args) { invariant(() => { assert.equal(this.gpu, 'metal'); assert.equal(this.buildType, 'prebuilt') }); const loaded")
s=s.replace("  active.grammar.push(record); event('grammar-start'", "  record.orderCheck = assertSchemaOrder(schema)\n  active.grammar.push(record); event('grammar-start'")
s=s.replace("    grammars.set(grammar, { runtime: this, record })", "    invariant(() => {\n      const expected = readFileSync(join(root, 'setup/grammars', active.id + '-' + arm + '.gbnf'), 'utf8')\n      assert.equal(grammar.grammar,expected)\n      if (arm === 'control') assert.equal(grammar.grammar,prior[active.id].grammar[0].grammar)\n      else assert.notEqual(grammar.grammar,prior[active.id].grammar[0].grammar)\n    })\n    grammars.set(grammar, { runtime: this, record })")
s=s.replace("  summary.samplingCalls++; durable('summary.json', summary)", "  invariant(() => assert.deepEqual(initial.samplingOrder[summary.samplingCalls], { arm, id: active.id }))\n  summary.samplingCalls++; durable('summary.json', summary)")
s=s.replace("    event('native-response-before-forward', { stopReason: result.stopReason, responseTextSha256: observation.responseTextSha256 })", "    try {\n      const parsed = JSON.parse(result.responseText)\n      observation.nativeOutputKeyOrder = { root: Object.keys(parsed), claims: parsed.claims.map(c => Object.keys(c)) }\n    } catch(error) { observation.nativeOutputKeyOrderError = String(error) }\n    event('native-response-before-forward', { stopReason: result.stopReason, responseTextSha256: observation.responseTextSha256 })")
s=s.replace("          assert.deepEqual(schema, old.grammar[0].schema)", "          assertSchemaOrder(schema)")
a=s.index("          if (arm === 'control') {\n            assert.equal(prompt.system")
b=s.index("\n        })",a)
s=s[:a]+"""          assert.equal(prompt.system, old.observed[0].history[0].text)
          assert.equal(prompt.inclusion.wireSha256, old.generation.output.inclusion.wireSha256)
          assert.deepEqual(tokenArray(prompt.user),old.observed[0].wireTokens)"""+s[b:]
s=s.replace("        invariant(() => assert.equal(grammar.grammar, prior[active.id].grammar[0].grammar))", "        invariant(() => assert.equal(grammar.grammar, readFileSync(join(root, 'setup/grammars', active.id + '-' + arm + '.gbnf'), 'utf8')))")
s=s.replace("        active.rawForwardingExact = true", "        active.rawForwardingExact = true\n        if (observed.nativeOutputKeyOrder) invariant(() => {\n          assert.deepEqual(observed.nativeOutputKeyOrder.root, ['status','claims'])\n          const keys = arm === 'control' ? ['id','text','kind','evidenceIds'] : ['id','evidenceIds','text','kind']\n          for (const order of observed.nativeOutputKeyOrder.claims) assert.deepEqual(order,keys)\n        })")
start=s.index("  const anchor = 'Answer the actual question")
end=s.index("  invariant(() => assert.equal(summary.samplingCalls, 0))",start)
s=s[:start]+"""  invariant(() => assert.equal(treatmentPrompt.CITED_ASK_SYSTEM,controlPrompt.CITED_ASK_SYSTEM))
  for (const entry of initial.samplingOrder) {
    arm = entry.arm; engine = makeEngine()
    try { await prepareCase(planned.find(c => c.id === entry.id)) }
    finally { await disposeArm() }
    originalsIntegrity()
  }
"""+s[end:]
start=s.index("  for (arm of ['control','treatment']) {",s.index("  mode = 'sampling'"))
end=s.index("    const row = summary.cases.find",start)
s=s[:start]+"""  for (const entry of initial.samplingOrder) {
    if (stopping || summary.stoppedReason) break
    arm = entry.arm
    const c = planned.find(c => c.id === entry.id)
    engine = makeEngine()
    const armStarted = performance.now()
    try {
"""+s[end:]
s=s.replace("    } } finally { await disposeArm() }", "    } finally { await disposeArm() }")
s=s.replace("event('sampling-arm-complete'", "event('sampling-entry-complete'")
(r/'runner.ts').write_text(s)
launch=(old/'launch.py').read_text().replace("sha=='ffa54854564ab9ad1b1fc21e844c4a18c92b7b15'", "sha=='c1fbb2e0a9d548f8d466229853d83a7d5ec71597'")
(r/'launch.py').write_text(launch)
