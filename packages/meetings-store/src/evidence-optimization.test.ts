import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { captureEvidenceParity } from './evidence-parity-fixture';

test('optimization preserves frozen pre-optimization complete bundles across Unicode, bounds, subsets and ties',()=>{
  const expected=JSON.parse(readFileSync(new URL('./evidence-parity-old.json',import.meta.url),'utf8'));
  assert.equal(expected.productionSha,'72c6ef47fb020b8d8d3dbc7c3c84c197efc23868');
  assert.deepEqual(captureEvidenceParity(),expected.cases);
});
