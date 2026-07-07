import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decidePullAction, shouldTrashLocally } from './sync-pull-logic'

describe('decidePullAction', () => {
  it('imports meetings that do not exist locally', () => {
    assert.equal(
      decidePullAction({
        localExists: false,
        localTrashed: false,
        localHash: null,
        syncedHash: null,
        remoteHash: 'r1'
      }),
      'import'
    )
  })

  it('skips identical content (the usual echo of our own push)', () => {
    assert.equal(
      decidePullAction({
        localExists: true,
        localTrashed: false,
        localHash: 'same',
        syncedHash: 'same',
        remoteHash: 'same'
      }),
      'skip'
    )
  })

  it('applies remote updates to a clean local copy', () => {
    assert.equal(
      decidePullAction({
        localExists: true,
        localTrashed: false,
        localHash: 'old',
        syncedHash: 'old', // local unchanged since last sync
        remoteHash: 'new'
      }),
      'apply'
    )
  })

  it('never overwrites local edits that have not been pushed', () => {
    assert.equal(
      decidePullAction({
        localExists: true,
        localTrashed: false,
        localHash: 'edited-locally',
        syncedHash: 'old', // dirty: local moved past the last sync
        remoteHash: 'new'
      }),
      'skip'
    )
  })

  it('never applies over a meeting with no sync history (conservative)', () => {
    assert.equal(
      decidePullAction({
        localExists: true,
        localTrashed: false,
        localHash: 'local-only',
        syncedHash: null,
        remoteHash: 'new'
      }),
      'skip'
    )
  })

  it('never resurrects a locally-trashed meeting', () => {
    assert.equal(
      decidePullAction({
        localExists: true,
        localTrashed: true,
        localHash: 'x',
        syncedHash: 'x',
        remoteHash: 'y'
      }),
      'skip'
    )
  })
})

describe('shouldTrashLocally', () => {
  it('trashes synced meetings that vanished from the cloud', () => {
    assert.equal(
      shouldTrashLocally({
        wasSynced: true,
        presentInCloud: false,
        localTrashed: false,
        localDirty: false
      }),
      true
    )
  })

  it('leaves never-synced local meetings alone', () => {
    assert.equal(
      shouldTrashLocally({
        wasSynced: false,
        presentInCloud: false,
        localTrashed: false,
        localDirty: false
      }),
      false
    )
  })

  it('spares dirty meetings — unsynced edits outrank a remote deletion', () => {
    assert.equal(
      shouldTrashLocally({
        wasSynced: true,
        presentInCloud: false,
        localTrashed: false,
        localDirty: true
      }),
      false
    )
  })

  it('is a no-op for meetings already in the trash', () => {
    assert.equal(
      shouldTrashLocally({
        wasSynced: true,
        presentInCloud: false,
        localTrashed: true,
        localDirty: false
      }),
      false
    )
  })

  it('does nothing while the id still exists in the cloud', () => {
    assert.equal(
      shouldTrashLocally({
        wasSynced: true,
        presentInCloud: true,
        localTrashed: false,
        localDirty: false
      }),
      false
    )
  })
})
