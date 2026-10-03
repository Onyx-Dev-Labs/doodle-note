import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SyncStatus } from '../../../shared/sync-api'
import { latestSyncStatus } from './sync-status'

const status = (revision: number, linking: boolean, connected = false): SyncStatus => ({
  statusRevision: revision,
  connectionRevision: connected ? 1 : 0,
  connected,
  enabled: connected,
  syncing: false,
  pendingCount: 0,
  linking,
  baseUrl: 'https://example.test'
})

test('mounted views ignore old getStatus/connect/cancel replies after a retry', () => {
  const retry = status(3, true)
  for (const stale of [status(0, false), status(1, true), status(2, false)]) {
    assert.equal(latestSyncStatus(retry, stale), retry)
  }
  const connected = status(4, false, true)
  assert.equal(latestSyncStatus(retry, connected), connected)
  assert.equal(latestSyncStatus(connected, retry), connected)
})

test('remount adopts authoritative pending, cancelled, timed-out, and connected status', () => {
  for (const current of [status(1, true), status(2, false), status(4, false, true)]) {
    assert.equal(latestSyncStatus(null, current), current)
  }
})
