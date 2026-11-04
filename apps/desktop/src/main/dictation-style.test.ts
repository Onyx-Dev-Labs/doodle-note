import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BUILTIN_STYLE_APPS,
  DEFAULT_STYLES,
  EMPTY_STYLE_APPS,
  STYLE_CATEGORIES,
  STYLE_TONES,
  STYLE_SAMPLE_INPUT,
  appsInCategory,
  applyStyle,
  categoryForApp,
  moveApp,
  removeApp,
  styleSample
} from '../shared/dictation-style'

test('proper: capitals and full punctuation', () => {
  assert.equal(applyStyle('hey are you free tomorrow', 'proper'), 'Hey are you free tomorrow.')
  assert.equal(applyStyle('Already fine.', 'proper'), 'Already fine.')
  assert.equal(applyStyle('is that ok? i think so', 'proper'), 'Is that ok? I think so.')
})

test('relaxed: capitals, no closing full stop, question and exclamation marks stay', () => {
  assert.equal(applyStyle('hey are you free tomorrow.', 'relaxed'), 'Hey are you free tomorrow')
  assert.equal(applyStyle('are you free tomorrow?', 'relaxed'), 'Are you free tomorrow?')
  assert.equal(applyStyle('see you there!', 'relaxed'), 'See you there!')
  assert.equal(applyStyle('wait... what', 'relaxed'), 'Wait... what')
  assert.equal(
    applyStyle('one thing. another thing.', 'relaxed'),
    'One thing. Another thing',
    'only the closing one goes'
  )
})

test('lowercase quick: no capitals except I and acronyms, no closing full stop', () => {
  assert.equal(applyStyle('Hey, Are You Free Tomorrow.', 'lowercase'), 'hey, are you free tomorrow')
  assert.equal(
    applyStyle("I think I'll call NASA about the API", 'lowercase'),
    "I think I'll call NASA about the API"
  )
  assert.equal(applyStyle('is that ok? I think so.', 'lowercase'), 'is that ok? I think so')
  assert.equal(
    applyStyle('did you try the iPhone or JavaScript?', 'lowercase'),
    'did you try the iPhone or JavaScript?'
  )
  assert.equal(applyStyle('Great!', 'lowercase'), 'great!')
})

test('lowercase quick keeps URLs, e-mail, file names and code exactly as spoken', () => {
  assert.equal(
    applyStyle('Open https://GitHub.com/Doodle/Note and edit Main.swift', 'lowercase'),
    'open https://GitHub.com/Doodle/Note and edit Main.swift'
  )
  assert.equal(
    applyStyle('Call getUserName for Sean@Inman.tech', 'lowercase'),
    'call getUserName for Sean@Inman.tech'
  )
})

test('lowercase quick keeps terms the user told us about (the dictionary hook)', () => {
  assert.equal(
    applyStyle('Ask Priya about Doodlenote', 'lowercase', { knownTerms: ['Priya', 'DoodleNote'] }),
    'ask Priya about DoodleNote'
  )
  assert.equal(
    applyStyle('Ask Priya', 'lowercase'),
    'ask priya',
    'nothing is known without a dictionary'
  )
})

test('styles leave other languages and empty text alone', () => {
  for (const tone of STYLE_TONES) {
    assert.equal(
      applyStyle('Esto es una prueba de la frase.', tone),
      'Esto es una prueba de la frase.'
    )
    assert.equal(applyStyle('これはテストです。', tone), 'これはテストです。')
    assert.equal(applyStyle('', tone), '')
    assert.equal(applyStyle('   ', tone), '   ')
  }
})

test('styles keep bullet lists intact', () => {
  const list = 'To do:\n- Milk\n- Eggs'
  assert.equal(applyStyle(list, 'proper'), list)
  assert.equal(applyStyle(list, 'relaxed'), list)
  assert.equal(applyStyle(list, 'lowercase'), 'to do:\n- milk\n- eggs')
})

test('each card sample shows its tone, from the same text', () => {
  assert.equal(
    styleSample('proper'),
    'Hey are you free tomorrow, I was thinking we could grab lunch at noon.'
  )
  assert.equal(
    styleSample('relaxed'),
    'Hey are you free tomorrow, I was thinking we could grab lunch at noon'
  )
  assert.equal(
    styleSample('lowercase'),
    'hey are you free tomorrow, I was thinking we could grab lunch at noon'
  )
  assert.ok(STYLE_SAMPLE_INPUT.includes('um'), 'the sample is raw speech')
})

test('the default tones suit each category', () => {
  assert.deepEqual(DEFAULT_STYLES, {
    personal: 'relaxed',
    work: 'proper',
    email: 'proper',
    other: 'proper'
  })
  assert.deepEqual(Object.keys(DEFAULT_STYLES).sort(), [...STYLE_CATEGORIES].sort())
})

test('categoryForApp: built-in apps, unknown apps and missing ids', () => {
  assert.equal(categoryForApp('com.tinyspeck.slackmacgap', EMPTY_STYLE_APPS), 'work')
  assert.equal(categoryForApp('com.microsoft.teams2', EMPTY_STYLE_APPS), 'work')
  assert.equal(categoryForApp('com.hnc.Discord', EMPTY_STYLE_APPS), 'personal')
  assert.equal(categoryForApp('net.whatsapp.WhatsApp', EMPTY_STYLE_APPS), 'personal')
  assert.equal(categoryForApp('com.apple.MobileSMS', EMPTY_STYLE_APPS), 'personal')
  assert.equal(categoryForApp('ru.keepcoder.Telegram', EMPTY_STYLE_APPS), 'personal')
  assert.equal(categoryForApp('com.apple.mail', EMPTY_STYLE_APPS), 'email')
  assert.equal(categoryForApp('com.microsoft.Outlook', EMPTY_STYLE_APPS), 'email')
  assert.equal(categoryForApp('com.apple.Notes', EMPTY_STYLE_APPS), 'other')
  assert.equal(
    categoryForApp('com.google.Chrome', EMPTY_STYLE_APPS),
    'other',
    'web mail is not detectable'
  )
  assert.equal(categoryForApp(null, EMPTY_STYLE_APPS), 'other')
  assert.equal(categoryForApp('', EMPTY_STYLE_APPS), 'other')
  assert.equal(
    categoryForApp('COM.APPLE.MAIL', EMPTY_STYLE_APPS),
    'email',
    'ids compare case-insensitively'
  )
})

test('the user can override and extend the built-in list', () => {
  const apps = moveApp(EMPTY_STYLE_APPS, 'com.apple.mail', 'work')
  assert.equal(
    categoryForApp('com.apple.mail', apps),
    'work',
    'a user move beats the built-in list'
  )
  const added = moveApp(apps, 'com.example.Chat', 'personal')
  assert.equal(categoryForApp('com.example.Chat', added), 'personal')
  // Moving it again takes it out of the first list.
  const again = moveApp(added, 'com.example.Chat', 'email')
  assert.deepEqual(again.personal, [])
  assert.equal(categoryForApp('com.example.Chat', again), 'email')
  const removed = removeApp(again, 'com.example.Chat')
  assert.equal(categoryForApp('com.example.Chat', removed), 'other')
  assert.equal(moveApp(EMPTY_STYLE_APPS, '  ', 'work'), EMPTY_STYLE_APPS, 'blank ids are ignored')
})

test('appsInCategory lists built-in apps first and drops the ones the user moved away', () => {
  const email = appsInCategory('email', EMPTY_STYLE_APPS).map((app) => app.bundleId)
  assert.deepEqual(email, BUILTIN_STYLE_APPS.email)
  const moved = moveApp(EMPTY_STYLE_APPS, 'com.apple.mail', 'work')
  assert.ok(!appsInCategory('email', moved).some((app) => app.bundleId === 'com.apple.mail'))
  const work = appsInCategory('work', moved)
  assert.deepEqual(work.at(-1), { bundleId: 'com.apple.mail', builtin: false })
  assert.deepEqual(appsInCategory('other', EMPTY_STYLE_APPS), [])
})
