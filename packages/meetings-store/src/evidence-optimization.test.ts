import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { captureEvidenceParity } from './evidence-parity-fixture';

test('optimization preserves frozen pre-optimization complete bundles across Unicode, bounds, subsets and ties',()=>{
  const expected=JSON.parse(readFileSync(new URL('./evidence-parity-old.json',import.meta.url),'utf8'));
  assert.equal(expected.productionSha,'72c6ef47fb020b8d8d3dbc7c3c84c197efc23868');
  assert.deepEqual(captureEvidenceParity(),expected.cases);
});

test('request-local masks preserve ae696e8 bundles including highest bits, phrase-only and long-window scores',()=>{
  const expected=JSON.parse(readFileSync(new URL('./evidence-parity-ae696e8.json',import.meta.url),'utf8'));
  assert.equal(expected.productionSha,'ae696e8b41371c540a4c976e7380b12835ab2f54');
  assert.deepEqual(captureEvidenceParity(true),expected.cases);
});
