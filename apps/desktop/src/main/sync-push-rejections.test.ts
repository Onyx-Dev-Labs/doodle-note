import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptySyncConfig, parseSyncConfigFromRaw } from './sync-config'
import {
  OTHER_WORKSPACE_REJECTION,
  isOtherWorkspaceRejection,
  otherWorkspaceMessage,
  partitionPushCandidates,
  rejectedPushMessage
} from './sync-push-rejections'

type Candidate = { id: string; hash: string }
const hashOf = (record: Candidate): string => record.hash

describe('push rejections', () => {
  it('recognizes only the cloud ownership rejection as permanent', () => {
    assert.equal(isOtherWorkspaceRejection(OTHER_WORKSPACE_REJECTION), true)
    assert.equal(isOtherWorkspaceRejection('write_rejected'), false)
    assert.equal(isOtherWorkspaceRejection(undefined), false)
  })

  it('parks unchanged content the cloud refused so cycles do not re-push it', () => {
    const a = { id: 'a', hash: 'h1' }
    const b = { id: 'b', hash: 'h2' }
    const { pending, blocked } = partitionPushCandidates([a, b], { a: 'h1' }, hashOf)
    assert.deepEqual(pending, [b])
    assert.deepEqual(blocked, [a])
  })

  it('retries a parked meeting once its content changes', () => {
    const edited = { id: 'a', hash: 'h1-edited' }
    const { pending, blocked } = partitionPushCandidates([edited], { a: 'h1' }, hashOf)
    assert.deepEqual(pending, [edited])
    assert.deepEqual(blocked, [])
  })

  it('explains parked and retryable rejections in sync status copy', () => {
    assert.equal(otherWorkspaceMessage(0), undefined)
    assert.equal(
      otherWorkspaceMessage(1),
      "1 meeting can't sync: it belongs to another workspace on the web."
    )
    assert.equal(
      otherWorkspaceMessage(3),
      "3 meetings can't sync: they belong to another workspace on the web."
    )
    assert.equal(rejectedPushMessage(0), undefined)
    assert.match(rejectedPushMessage(2)!, /^2 meetings were rejected/)
  })
})

describe('blockedPushes persistence', () => {
  it('round-trips parked hashes and drops malformed entries', () => {
    const config = parseSyncConfigFromRaw({
      enabled: true,
      blockedPushes: { a: 'h1', b: 42 as unknown as string }
    })
    assert.deepEqual(config.blockedPushes, { a: 'h1' })
    assert.deepEqual(parseSyncConfigFromRaw({ enabled: true }).blockedPushes, {})
    assert.deepEqual(
      parseSyncConfigFromRaw({ blockedPushes: ['a'] as unknown as Record<string, string> })
        .blockedPushes,
      {}
    )
  })

  it('hands out independent empty configs so a reset cannot inherit parked ids', () => {
    const first = emptySyncConfig()
    first.blockedPushes.a = 'h1'
    first.pushed.a = 'h1'
    const second = emptySyncConfig()
    assert.deepEqual(second.blockedPushes, {})
    assert.deepEqual(second.pushed, {})
  })
})
