import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localSourceScope, resolveOriginalSource } from '@repo/meetings-store/sources'
import { retrieveOriginalEvidence, validateOriginalEvidence } from '@repo/meetings-store/evidence'
import { buildCitedAskPrompt } from '@repo/ai'
import { MainCitedAskService } from '../../src/main/cited-ask-service'
import { GlobalChatStore, CITED_CHAT_FALLBACK } from '../../src/main/global-chat-store'
import { HomeCitedController } from '../../src/main/home-cited-controller'
import { LibraryActivity } from '../../src/main/library-activity'

export function fixture(t: test.TestContext): {
  root: string
  file: string
  original: Buffer
  put(text: string): void
  history: string
  store: GlobalChatStore
  activity: LibraryActivity
  cited: MainCitedAskService
  controller: HomeCitedController
  owner: import('../../src/main/cited-ask-host').CitedOwnerLease
  request: import('../../src/shared/home-cited-api').HomeCitedRequest
  generated(): number
  setHold(fn: () => Promise<void>): void
} {
  const root = mkdtempSync(join(tmpdir(), 'dev507-home-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'originals')
  mkdirSync(dir)
  const file = join(dir, 'one.json')
  const put = (text: string): void =>
    writeFileSync(file, JSON.stringify({ id: 'one', rawNotesMarkdown: text }))
  put('Orchid ships Friday.')
  const original = readFileSync(file)
  const context = { meetingsDir: dir, scope: localSourceScope(dir, true), authorized: true }
  const history = join(root, 'global-chat.json')
  writeFileSync(
    history,
    JSON.stringify([
      { question: 'Prior', answer: 'Legacy', askedAt: '2020-01-01', unknown: { retained: true } }
    ])
  )
  const store = new GlobalChatStore(
    () => history,
    () => {}
  )
  const activity = new LibraryActivity()
  let hold = async (): Promise<void> => {}
  let generated = 0
  const cited = new MainCitedAskService({
    activity,
    sources: {
      retrieveEvidence: async (s) => retrieveOriginalEvidence(context, s),
      validateEvidence: async (m) => validateOriginalEvidence(context, m),
      resolveAcknowledged: async (a) => resolveOriginalSource(context, a)
    },
    validateModel: async () => true,
    generate: async (input) => {
      generated++
      await hold()
      const p = buildCitedAskPrompt(input, {
        contextWindowTokens: 16384,
        outputReserveTokens: 4096,
        safetyMarginTokens: 256,
        accounting: 'model-tokenizer',
        countInputTokens: (s, u) => Buffer.byteLength(s + u)
      })
      return {
        rawJson: JSON.stringify({
          status: 'answered',
          claims: [
            {
              id: 'claim',
              kind: 'quotation',
              text: 'model text ignored',
              evidenceIds: [p.inclusion.ranges[0]!.id]
            }
          ]
        }),
        inclusion: p.inclusion,
        engineId: 'local:synthetic',
        modelArtifactRevision: 'synthetic'
      }
    }
  })
  const controller = new HomeCitedController({ store, cited, activity, enabled: () => true })
  const owner = {
    ownerId: 'home-owner',
    signal: new AbortController().signal,
    assertCurrent: () => {}
  }
  const request = { runId: 'run', question: 'Orchid', filters: {} }
  return {
    root,
    file,
    original,
    put,
    history,
    store,
    activity,
    cited,
    controller,
    owner,
    request,
    generated: () => generated,
    setHold: (fn: () => Promise<void>) => {
      hold = fn
    }
  }
}
