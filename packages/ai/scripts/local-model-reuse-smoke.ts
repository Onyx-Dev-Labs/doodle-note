/** Optional real-model smoke. Reads existing weights; never downloads them.
 * Pass one or more existing DoodleNote model directories as arguments. */
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOCAL_MODELS } from '../src/catalog'
import { LocalNotesEngine } from '../src/local-engine'
import { LocalModelStore } from '../src/model-store'

const directories = process.argv.slice(2)
if (!directories.length)
  throw new Error('Pass existing model directories. This smoke never downloads.')
const profile = await mkdtemp(join(tmpdir(), 'doodle-reuse-smoke-'))
const models = join(profile, 'models')
const spec = LOCAL_MODELS[0]!
let engine: LocalNotesEngine | undefined
try {
  const store = new LocalModelStore([models, ...directories])
  const before = Date.now()
  const modelPath = await store.ensure(spec, async () => {
    throw new Error('Unexpected download')
  })
  const original = await stat(modelPath)
  console.log(`Verified existing Qwen in ${Date.now() - before}ms (${original.size} bytes).`)
  assert.equal(await new LocalModelStore([models, ...directories]).find(spec), modelPath)
  engine = new LocalNotesEngine({ modelUri: spec.uri, modelPath, contextSize: 2048 })
  await engine.prepare()
  const result = await engine.generateNotes({
    title: 'Synthetic launch check',
    rawNotesMarkdown: '',
    speakers: [],
    segments: [
      {
        speaker: 'Alex',
        text: 'We decided to launch the demo on Friday. Sam will write the checklist by Thursday.',
        startMs: 0
      }
    ]
  })
  assert.ok(result.markdown.length > 20)
  assert.match(result.markdown, /Friday|Thursday/i)
  assert.equal(result.engine, `local:${spec.uri}`)
  assert.equal((await stat(modelPath)).ino, original.ino)
  await assert.rejects(readdir(models), { code: 'ENOENT' })
  console.log(
    'PASS: existing file reused; restart discovery, local generation and no weights copy verified.'
  )
  console.log(result.markdown)
} finally {
  await engine?.dispose()
  await rm(profile, { recursive: true, force: true })
}
