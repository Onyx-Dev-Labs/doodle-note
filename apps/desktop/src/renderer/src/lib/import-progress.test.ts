import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importProgressText, newerImportState, isImportActive } from './import-progress'
import type { ImportProgress } from '../../../shared/import-api'
const job: ImportProgress = {
  jobId: 'fixture',
  meetingId: 'fixture',
  kind: 'import',
  label: 'fixture.wav',
  stage: 'transcribing',
  revision: 2
}
test('late snapshot cannot roll back a new job or terminal event', () => {
  const terminal = { ...job, stage: 'completed' as const, revision: 3 }
  assert.equal(newerImportState(terminal, job), terminal)
  assert.equal(newerImportState(terminal, null), terminal)
  const next = { ...job, jobId: 'next', revision: 4 }
  assert.equal(newerImportState(terminal, next), next)
  assert.equal(newerImportState(null, job), job)
})
test('transcription has no invented fraction and every terminal state is inactive', () => {
  assert.doesNotMatch(importProgressText(job), /%/)
  assert.match(importProgressText({ ...job, stage: 'downloading_model', progress: 0.42 }), /42%/)
  for (const stage of ['completed', 'canceled', 'failed'] as const)
    assert.equal(isImportActive({ ...job, stage }), false)
  assert.equal(isImportActive({ ...job, stage: 'canceling' }), true)
})
