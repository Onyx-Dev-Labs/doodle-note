import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { CalendarContextCodec } from './calendar-context-codec'

test('worker codec round-trips unknown JSON and exact byte hashes without blocking a pending main task', async () => {
  const codec = new CalendarContextCodec()
  try {
    const value = { unknown: 'x'.repeat(16 * 1024 * 1024), nested: { retained: [1, true, null] } }
    const bytes = Buffer.from(JSON.stringify(value))
    const hash = createHash('sha256').update(bytes).digest('hex')
    let yielded = false
    setImmediate(() => {
      yielded = true
    })
    const decoded = await codec.decode(bytes)
    assert.equal(yielded, true)
    assert.equal(decoded.digest, hash)
    assert.deepEqual(decoded.value, value)
    const encoded = await codec.encode(decoded.value)
    assert.equal(encoded.digest, hash)
    assert.equal(encoded.bytes, Buffer.byteLength(encoded.serialized))
    assert.deepEqual(JSON.parse(encoded.serialized), value)
    assert.equal(await codec.hash(Buffer.from(encoded.serialized)), hash)
    await assert.rejects(codec.decode(Buffer.from('{bad')))
  } finally {
    await codec.close()
  }
})
test('closing codec rejects pending work and never permits a late result', async () => {
  const codec = new CalendarContextCodec()
  const pending = codec.encode({ padding: 'x'.repeat(1024 * 1024) })
  const rejection = assert.rejects(pending, /closed/)
  await codec.close()
  await rejection
  await assert.rejects(codec.encode({}), /closed/)
})
