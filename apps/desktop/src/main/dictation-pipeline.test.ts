import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_DICTATION_SETTINGS, type DictationSettings } from '../shared/dictation-api'
import { BUILTIN_TRANSFORMS } from '../shared/dictation-transforms'
import { moveApp } from '../shared/dictation-style'
import {
  deterministicText,
  fallbackText,
  planDictation,
  resolveModel,
  runModelSteps,
  type ModelOptions
} from './dictation-pipeline'

const noModel: ModelOptions = { localModelLabel: null, byok: null }
const local: ModelOptions = { localModelLabel: 'Qwen local', byok: null }
const provider: ModelOptions = {
  localModelLabel: null,
  byok: { provider: 'openai', model: 'gpt-x', hasKey: true }
}
const consent = { provider: 'openai', model: 'gpt-x' }

const settings = (over: Partial<DictationSettings> = {}): DictationSettings => ({
  ...DEFAULT_DICTATION_SETTINGS,
  enabled: true,
  ...over
})

const withTransforms = (
  autoApplyId: string | null,
  enabled = true
): DictationSettings['transforms'] => ({
  enabled,
  autoApply: autoApplyId !== null,
  autoApplyId,
  items: BUILTIN_TRANSFORMS.map((item) => ({ ...item }))
})

test('resolveModel: the notes model first, then a consented provider, else nothing', () => {
  assert.deepEqual(resolveModel(local, settings()), {
    path: 'local',
    label: 'Qwen local',
    engine: 'local'
  })
  assert.equal(resolveModel(provider, settings({ byokConsent: consent })).engine, 'byok')
  assert.deepEqual(resolveModel(provider, settings()), {
    path: 'needs-consent',
    label: 'openai',
    engine: null
  })
  assert.equal(resolveModel(noModel, settings()).path, 'none')
  assert.equal(
    resolveModel(provider, settings({ byokConsent: { provider: 'openai', model: 'other' } })).path,
    'needs-consent',
    'consent is bound to the provider and model'
  )
  assert.equal(
    resolveModel(
      { ...provider, byok: { ...provider.byok!, hasKey: false } },
      settings({ byokConsent: consent })
    ).path,
    'none',
    'no key, no provider'
  )
})

test('resolveModel: a user who picked their provider before keeps it over the local model', () => {
  const both = { localModelLabel: 'Qwen local', byok: provider.byok }
  assert.equal(resolveModel(both, settings({ byokConsent: consent })).engine, 'local')
  assert.equal(
    resolveModel(both, settings({ byokConsent: consent, cleanupMode: 'byok' })).engine,
    'byok'
  )
  assert.equal(
    resolveModel(both, settings({ cleanupMode: 'byok' })).engine,
    'local',
    'not without consent'
  )
})

test('the plan follows the settings, and Full becomes Light when no model can run', () => {
  const full = settings({ tidyLevel: 'full' })
  assert.equal(planDictation(full, local, null).tidy, 'full')
  assert.equal(planDictation(full, local, null).steps, 1)
  assert.equal(planDictation(full, noModel, null).tidy, 'light')
  assert.equal(planDictation(full, noModel, null).steps, 0)
  assert.equal(
    planDictation(full, provider, null).tidy,
    'light',
    'a provider without consent is not used'
  )
  assert.equal(planDictation(settings({ tidyLevel: 'off' }), local, null).tidy, 'off')
})

test('the plan picks the tone from the focused app', () => {
  const s = settings({
    styles: { personal: 'lowercase', work: 'relaxed', email: 'proper', other: 'proper' }
  })
  assert.equal(planDictation(s, noModel, 'com.hnc.Discord').tone, 'lowercase')
  assert.equal(planDictation(s, noModel, 'com.tinyspeck.slackmacgap').tone, 'relaxed')
  assert.equal(planDictation(s, noModel, 'com.apple.Notes').category, 'other')
  const moved = settings({
    styleApps: moveApp(settings().styleApps, 'com.apple.Notes', 'personal')
  })
  assert.equal(planDictation(moved, noModel, 'com.apple.Notes').category, 'personal')
})

test('auto-apply needs the opt-in, a model, and a transform that still exists', () => {
  const on = settings({ transforms: withTransforms('polish') })
  assert.equal(planDictation(on, local, null).transform?.id, 'polish')
  assert.equal(planDictation(on, local, null).steps, 1)
  assert.equal(planDictation(on, noModel, null).transform, null)
  assert.equal(
    planDictation(settings({ transforms: withTransforms('polish', false) }), local, null).transform,
    null
  )
  assert.equal(
    planDictation(settings({ transforms: withTransforms(null) }), local, null).transform,
    null
  )
  const both = settings({ tidyLevel: 'full', transforms: withTransforms('polish') })
  assert.equal(planDictation(both, local, null).steps, 2)
})

test('without a model step the text is Light tidy-up then the style, instantly', () => {
  const plan = planDictation(settings(), noModel, null)
  assert.equal(deterministicText('um so i think we should go', plan), 'So I think we should go.')
  const relaxed = planDictation(
    settings({ styles: { ...settings().styles, other: 'relaxed' } }),
    noModel,
    null
  )
  assert.equal(deterministicText('um so i think we should go', relaxed), 'So I think we should go')
  const lower = planDictation(
    settings({ styles: { ...settings().styles, other: 'lowercase' } }),
    noModel,
    null
  )
  assert.equal(deterministicText('um so i think we should go', lower), 'so I think we should go')
})

test('Off inserts the raw words untouched, styles included', () => {
  const plan = planDictation(
    settings({ tidyLevel: 'off', styles: { ...settings().styles, other: 'lowercase' } }),
    noModel,
    null
  )
  assert.equal(deterministicText('um so i think we should go', plan), 'um so i think we should go')
})

test('the fallback is the raw words with the style, or the Light result for Light', () => {
  const full = planDictation(settings({ tidyLevel: 'full' }), local, null)
  assert.equal(
    fallbackText('um so i think so', full),
    'Um so I think so.',
    'raw words, only the style applied'
  )
  const light = planDictation(settings(), local, null)
  assert.equal(fallbackText('um so i think so', light), 'So I think so.')
})

const run = (
  outputs: Array<string | Error>
): { runner: (r: { system: string; prompt: string }) => Promise<string>; calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    runner: async (request) => {
      calls.push(request.prompt)
      const next = outputs.shift()
      if (next instanceof Error) throw next
      return next ?? ''
    }
  }
}
const live = new AbortController().signal

test('a Full tidy-up result replaces the raw words, then the style applies', async () => {
  const plan = planDictation(settings({ tidyLevel: 'full' }), local, null)
  const { runner, calls } = run(['we should go on Tuesday'])
  const out = await runModelSteps('um we should uh go on Tuesday', plan, runner, live)
  assert.equal(out.text, 'We should go on Tuesday.')
  assert.equal(out.note, null)
  assert.equal(calls.length, 1)
  assert.match(calls[0]!, /<transcript>/)
  assert.ok(out.timings.tidyMs !== null && out.timings.transformMs === null)
})

test('a doubtful or failing Full tidy-up keeps the raw words and says why', async () => {
  const plan = planDictation(settings({ tidyLevel: 'full' }), local, null)
  const changed = await runModelSteps(
    'we meet at 5 pm',
    plan,
    run(['we meet at 6 pm']).runner,
    live
  )
  assert.equal(changed.text, 'We meet at 5 pm.', 'the number changed, so the raw words stand')
  assert.match(changed.note ?? '', /changed a number.*raw transcript was used/)
  const failed = await runModelSteps(
    'we meet at 5 pm',
    plan,
    run([new Error('model busy')]).runner,
    live
  )
  assert.equal(failed.text, 'We meet at 5 pm.')
  assert.match(failed.note ?? '', /model busy\..*raw transcript/)
  const answered = await runModelSteps(
    'what is two plus two',
    plan,
    run(['Sure, it is four.']).runner,
    live
  )
  assert.match(answered.text, /^What is two plus two/)
})

test('an abort is rethrown, never turned into a quiet fallback', async () => {
  const plan = planDictation(settings({ tidyLevel: 'full' }), local, null)
  const controller = new AbortController()
  const runner = async (): Promise<string> => {
    controller.abort()
    throw new Error('aborted')
  }
  await assert.rejects(runModelSteps('hello world', plan, runner, controller.signal))
})

test('an auto-applied transform runs after tidy-up and the style, and records the change', async () => {
  const plan = planDictation(settings({ transforms: withTransforms('shorter') }), local, null)
  const { runner, calls } = run(['We should go.'])
  const out = await runModelSteps('um we should really go there soon', plan, runner, live)
  assert.equal(out.text, 'We should go.')
  assert.deepEqual(out.change, {
    name: 'Make it shorter',
    before: 'We should really go there soon.',
    after: 'We should go.'
  })
  assert.match(
    calls[0]!,
    /We should really go there soon\./,
    'it was given the tidied, styled text'
  )
  assert.match(calls[0]!, /^<text>/)
  assert.ok(out.timings.transformMs !== null, 'counted in the timings')
})

test('a failing transform keeps the text before it and says so', async () => {
  const plan = planDictation(settings({ transforms: withTransforms('polish') }), local, null)
  const failed = await runModelSteps(
    'send it on Friday',
    plan,
    run([new Error('timed out')]).runner,
    live
  )
  assert.equal(failed.text, 'Send it on Friday.')
  assert.equal(failed.change, null)
  assert.match(failed.note ?? '', /Polish: timed out\. The text before it was used\./)
  const doubted = await runModelSteps(
    'send it on Friday',
    plan,
    run(['Send it on Monday.']).runner,
    live
  )
  assert.equal(doubted.text, 'Send it on Friday.')
  assert.match(doubted.note ?? '', /Polish:.*changed a (number|name)/)
  const empty = await runModelSteps('send it on Friday', plan, run(['']).runner, live)
  assert.equal(empty.text, 'Send it on Friday.')
})

test('a transform that changes nothing records no change', async () => {
  const plan = planDictation(settings({ transforms: withTransforms('polish') }), local, null)
  const out = await runModelSteps(
    'Send it on Friday.',
    plan,
    run(['Send it on Friday.']).runner,
    live
  )
  assert.equal(out.change, null)
  assert.equal(out.note, null)
})

test('Full tidy-up and a transform chain, each falling back on its own', async () => {
  const plan = planDictation(
    settings({ tidyLevel: 'full', transforms: withTransforms('bullets') }),
    local,
    null
  )
  const ok = run(['we ship Friday and test Monday', '- Ship Friday\n- Test Monday'])
  const out = await runModelSteps('um we ship Friday and uh test Monday', plan, ok.runner, live)
  assert.equal(out.text, '- Ship Friday\n- Test Monday')
  assert.equal(ok.calls.length, 2)
  const half = run(['we ship Friday and test Monday', new Error('busy')])
  const kept = await runModelSteps('um we ship Friday and uh test Monday', plan, half.runner, live)
  assert.equal(
    kept.text,
    'We ship Friday and test Monday.',
    'the tidy-up survives a failed transform'
  )
  assert.match(kept.note ?? '', /Make it|Bullet summary/)
})

test('oversized text skips the model steps instead of sending it', async () => {
  const plan = planDictation(
    settings({ tidyLevel: 'full', transforms: withTransforms('polish') }),
    local,
    null
  )
  const long = `${'word '.repeat(2_000)}end`
  const { runner, calls } = run([])
  const out = await runModelSteps(long, plan, runner, live)
  assert.equal(calls.length, 0)
  assert.match(out.note ?? '', /Too long/)
})

const entries = (...pairs: Array<[string, string]>): DictationSettings['dictionary'] =>
  pairs.map(([from, to], index) => ({
    id: `d${index}`,
    from,
    to,
    source: 'manual' as const,
    count: 1,
    at: 1
  }))

test('the dictionary applies at every tidy level, including Off', () => {
  const dictionary = entries(['alec', 'Alex'])
  for (const tidyLevel of ['off', 'light'] as const) {
    const plan = planDictation(settings({ tidyLevel, dictionary }), noModel, null)
    assert.equal(deterministicText('tell alec hello', plan).includes('Alex'), true, tidyLevel)
  }
})

test('a style cannot change how a dictionary word is written', () => {
  const plan = planDictation(
    settings({
      tidyLevel: 'light',
      dictionary: entries(['alec', 'Alex']),
      styles: { personal: 'lowercase', work: 'lowercase', email: 'lowercase', other: 'lowercase' }
    }),
    noModel,
    null
  )
  assert.match(deterministicText('hey alec are you free', plan), /Alex/)
})

test('the dictionary applies to model output, to the fallback, and to a transform result', async () => {
  const dictionary = entries(['alec', 'Alex'])
  const plan = planDictation(
    settings({ tidyLevel: 'full', dictionary, transforms: withTransforms('polish') }),
    local,
    null
  )
  assert.match(fallbackText('tell alec hello', plan), /Alex/)
  const outcome = await runModelSteps(
    'tell alec hello',
    plan,
    async () => 'Tell Alec hello.',
    new AbortController().signal
  )
  assert.match(outcome.text, /Alex/)
  assert.ok(!/Alec/.test(outcome.text))
  if (outcome.change)
    assert.equal(outcome.change.after, outcome.text, 'View and Undo see what was typed')
})
