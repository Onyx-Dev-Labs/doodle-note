import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyMcpServerUrl, remoteMcpSetup } from '@repo/agent-contract/setup'

test('remote setup uses the configured HTTPS origin without leaking URL parameters', () => {
  const setup = remoteMcpSetup('https://notes.example.test/settings?token=do-not-copy#secret')!
  assert.equal(setup.serverUrl, 'https://notes.example.test/api/mcp')
  assert.equal(setup.agentsUrl, 'https://notes.example.test/app/settings/agents')
  const config = JSON.parse(setup.registrationJson)
  assert.equal(config.toolkit_config.app_url, setup.serverUrl)
  assert.deepEqual(config.toolkit_config.auth_schemes, [
    {
      mode: 'API_KEY',
      headers: { Authorization: 'Bearer {{generic_api_key}}' }
    }
  ])
  assert.equal(setup.registrationJson.includes('do-not-copy'), false)
  assert.equal(setup.registrationJson.includes('mcpServers'), false)
})

test('remote setup does not fall back to the official server for invalid/self-hosted config', () => {
  for (const baseUrl of [
    undefined,
    '',
    'not a URL',
    'http://localhost:4040',
    'file:///tmp/server',
    'https://user:secret@notes.example.test'
  ]) {
    assert.equal(remoteMcpSetup(baseUrl), null)
  }
})

test('copy writes only the server URL and does not report success before the write completes', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const writes: string[] = []
  let settled = false
  const url = remoteMcpSetup('https://www.doodlenote.ai')!.serverUrl
  const result = copyMcpServerUrl(url, async (text) => {
    writes.push(text)
    await pending
  })
  void result.then(() => {
    settled = true
  })
  await Promise.resolve()
  assert.equal(settled, false)
  assert.deepEqual(writes, ['https://www.doodlenote.ai/api/mcp'])
  finish()
  assert.deepEqual(await result, {
    ok: true,
    message: 'Server URL copied. Finish setup in Composio.'
  })
})

test('clipboard rejection and missing API return a manual-copy fallback without error contents', async () => {
  for (const write of [
    () => {
      throw new Error('private error details')
    },
    () => Promise.reject(new Error('private error details'))
  ]) {
    const result = await copyMcpServerUrl('https://www.doodlenote.ai/api/mcp', write)
    assert.equal(result.ok, false)
    assert.match(result.message, /Select and copy/)
    assert.equal(result.message.includes('private'), false)
  }
})
