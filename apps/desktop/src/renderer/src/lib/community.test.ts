import test from 'node:test'
import assert from 'node:assert/strict'
import { COMMUNITY_URL } from './community'

test('the community link is a plain https Discord invite', () => {
  const url = new URL(COMMUNITY_URL)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'discord.gg')
  assert.match(url.pathname, /^\/[A-Za-z0-9-]+$/)
  assert.equal(url.search, '')
})
