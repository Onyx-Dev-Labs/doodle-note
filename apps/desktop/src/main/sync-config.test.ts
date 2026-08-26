import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseSyncConfigFromRaw } from './sync-config'

describe('parseSyncConfigFromRaw', () => {
  it('restores pullCursor from persisted sync.json', () => {
    const config = parseSyncConfigFromRaw({
      enabled: true,
      pullCursor: '2026-08-06T14:50:30.123Z',
      pushed: {},
      mediaUrls: {},
      pendingDeletes: [],
      syncedFolders: {},
      pendingFolderDeletes: []
    })
    assert.equal(config.pullCursor, '2026-08-06T14:50:30.123Z')
  })

  it('omits pullCursor when absent or non-string', () => {
    assert.equal(parseSyncConfigFromRaw({ enabled: false }).pullCursor, undefined)
    assert.equal(
      parseSyncConfigFromRaw({ enabled: false, pullCursor: 123 as unknown as string }).pullCursor,
      undefined
    )
  })
})
