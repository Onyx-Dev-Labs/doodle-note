import assert from 'node:assert/strict'
import { test } from 'node:test'
import { notesProgressLabel } from '../shared/notes-progress'

test('local notes labels distinguish preparing, reading, first-token writing and cancellation', () => {
  assert.equal(notesProgressLabel({ phase: 'preparing' }), 'Preparing model')
  assert.equal(notesProgressLabel({ phase: 'reading' }), 'Reading transcript')
  assert.equal(notesProgressLabel({ phase: 'writing' }), 'Writing notes')
  assert.equal(
    notesProgressLabel({ phase: 'reading', current: 2, total: 3 }),
    'Reading transcript · part 2 of 3'
  )
  assert.equal(
    notesProgressLabel({ phase: 'condensing', current: 2, total: 3 }),
    'Condensing part 2 of 3'
  )
  assert.equal(notesProgressLabel({ phase: 'canceling' }), 'Stopping model')
})
