import assert from 'node:assert/strict'
import { test } from 'node:test'
import { looksEnglish, normalizeCaseAndPunctuation, tidyLight } from '../shared/dictation-tidy'

function table(name: string, rows: Array<[string, string, string?]>): void {
  test(name, () => {
    for (const [input, expected, why] of rows) {
      assert.equal(tidyLight(input), expected, why ?? input)
    }
  })
}

table('fillers: um, uh and the commas that framed them', [
  ['um I think we should go', 'I think we should go.'],
  ['so, um, I think we should go', 'So, I think we should go.'],
  ['I think uh we should go', 'I think we should go.'],
  ['well, uhm, maybe tomorrow', 'Well, maybe tomorrow.'],
  ['Um, can you send it', 'Can you send it.'],
  ['we need to uh uh finish this', 'We need to finish this.'],
  ['it was good, erm, really good', 'It was good, really good.'],
  [
    'The umbrella is under the umpire',
    'The umbrella is under the umpire.',
    'words that contain um are untouched'
  ],
  ['uh-huh that works for me', 'Uh-huh that works for me.', 'uh-huh is an answer, not a filler']
])

table('filler phrases only when plainly set off by commas', [
  ['it was great, you know, really great', 'It was great, really great.'],
  ['You know, I think we should wait', 'I think we should wait.'],
  ['we went home, you know.', 'We went home.'],
  [
    'do you know the way to the station',
    'Do you know the way to the station.',
    '"you know" as a real question stays'
  ],
  ['as you know the deadline moved', 'As you know the deadline moved.'],
  ['it was, like, really good', 'It was, really good.'],
  ['I like pizza and I like pasta', 'I like pizza and I like pasta.', '"like" as a verb stays'],
  ['it looks like rain', 'It looks like rain.', '"like" as a comparison stays'],
  ['would you like some tea', 'Would you like some tea.'],
  ['it was, I mean, really good', 'It was, really good.']
])

table('stutters and repeated words', [
  ['the the meeting is at noon', 'The meeting is at noon.'],
  ['I I think we should go', 'I think we should go.'],
  ['we we we should leave', 'We should leave.'],
  ['I, I think so', 'I think so.'],
  ['wh- what time is it', 'What time is it.'],
  ['I think I think we should go', 'I think we should go.'],
  ['it was very very good', 'It was very very good.', 'emphasis is legitimate'],
  ['he said that that was fine', 'He said that that was fine.'],
  ['no no no that is wrong', 'No no no that is wrong.'],
  [
    'go to Paris, Paris is lovely',
    'Go to Paris, Paris is lovely.',
    'a long word after a comma is a new clause'
  ],
  ['room 10 10 people', 'Room 10 10 people.', 'numbers are never collapsed']
])

table('spoken corrections: a number for a number, a name for a name', [
  ['meet at three, no, I mean four', 'Meet at four.'],
  ['meet at 3, I mean 4 tomorrow', 'Meet at 4 tomorrow.'],
  ['it costs ten, sorry, I meant twelve dollars', 'It costs twelve dollars.'],
  ['send it to John, I mean Jane', 'Send it to Jane.'],
  ['call Monday, no, I mean Tuesday', 'Call Tuesday.'],
  [
    'it was great, I mean really great',
    'It was great, I mean really great.',
    'not a number or a name: left alone'
  ],
  ['I mean it, I really do', 'I mean it, I really do.'],
  ['we need five, I mean six chairs and four tables', 'We need six chairs and four tables.'],
  ['the code is 4 5 2, no, I mean 4 5 3', 'The code is 4 5 3.']
])

table('scratch that drops the sentence before it', [
  ['send it to Bob, scratch that, send it to Alice', 'Send it to Alice.'],
  [
    'We start at nine. Order lunch, scratch that. Book the room',
    'We start at nine. Book the room.'
  ],
  ['okay scratch that', 'Okay scratch that.', 'nothing follows, so it is left alone']
])

table('spoken lists become bullets', [
  [
    'my groceries first milk second eggs third bread',
    'My groceries first milk second eggs third bread.',
    'no sentence breaks: not enough structure to be sure'
  ],
  [
    'the groceries. first, milk. second, eggs. third, bread.',
    'The groceries:\n- Milk\n- Eggs\n- Bread'
  ],
  ['one, call Bob. two, email Alice.', '- Call Bob\n- Email Alice'],
  [
    'First we check the logs. Second we restart the service.',
    '- We check the logs\n- We restart the service'
  ],
  [
    'To do. first, write the report. second, send it. finally, celebrate.',
    'To do:\n- Write the report\n- Send it\n- Celebrate'
  ],
  [
    'One day I went home. Two of them left.',
    'One day I went home. Two of them left.',
    'no comma: not a list'
  ],
  ['first, milk.', 'First, milk.', 'one item is not a list'],
  ['second, eggs. third, bread.', 'Second, eggs. Third, bread.', 'a list starts at one'],
  ['1. milk 2. eggs', '1. Milk 2. Eggs.', 'digits need sentence breaks to become bullets']
])

table('capital letters, I, and the final full stop', [
  ['hello there', 'Hello there.'],
  ['i think i can do it. i am sure', 'I think I can do it. I am sure.'],
  ["i'm sure i'll be there and i've said so", "I'm sure I'll be there and I've said so."],
  ['what time is it?', 'What time is it?'],
  ['great!', 'Great!'],
  ['see you soon,', 'See you soon.'],
  ['it costs 3.5 dollars. that is fine', 'It costs 3.5 dollars. That is fine.'],
  ['use e.g. a hammer. then stop', 'Use e.g. a hammer. Then stop.'],
  ['he said "ok"', 'He said "ok".']
])

table('URLs, e-mail, file names and code identifiers are left alone', [
  ['go to example.com and sign in', 'Go to example.com and sign in.'],
  [
    'open https://github.com/doodle/note then click',
    'Open https://github.com/doodle/note then click.'
  ],
  ['email me at sam@example.com please', 'Email me at sam@example.com please.'],
  ['edit main.swift and run it', 'Edit main.swift and run it.'],
  ['call the getUserName function', 'Call the getUserName function.'],
  ['set max_retries to five', 'Set max_retries to five.'],
  ['example.com is down', 'example.com is down.', 'a domain at the start is not capitalised'],
  ['run `npm test` first', 'Run `npm test` first.'],
  ['the path is /usr/local/bin and it works', 'The path is /usr/local/bin and it works.'],
  ['visit www.doodlenote.ai', 'Visit www.doodlenote.ai']
])

table('numbers and names are never altered', [
  ['we shipped 1,200 units on March 3rd', 'We shipped 1,200 units on March 3rd.'],
  ['Priya and Sean meet at 4:30', 'Priya and Sean meet at 4:30.'],
  ['the invoice total is $1,450.75', 'The invoice total is $1,450.75.'],
  ['uh call 555 0100 um after five', 'Call 555 0100 after five.']
])

table('other languages pass through untouched', [
  ['Esto es una prueba, eh, de la frase', 'Esto es una prueba, eh, de la frase'],
  ['um café por favor', 'um café por favor', 'um is Portuguese for one'],
  ['Das ist ein Test mit mehreren Wörtern', 'Das ist ein Test mit mehreren Wörtern'],
  ['Ceci est une phrase de test avec des mots', 'Ceci est une phrase de test avec des mots'],
  ['これはテストです', 'これはテストです'],
  ['Это тестовое предложение', 'Это тестовое предложение'],
  ['  spaced   out   ', 'Spaced out.']
])

test('looksEnglish: scripts, accents and short text', () => {
  assert.equal(looksEnglish('I think we should go home'), true)
  assert.equal(looksEnglish('um I think'), true)
  assert.equal(looksEnglish('hola amigo'), false)
  assert.equal(looksEnglish('um café'), false, 'an accent and no English word')
  assert.equal(looksEnglish('okay'), true, 'no evidence counts as English')
  assert.equal(looksEnglish('これはテスト'), false)
  assert.equal(looksEnglish('Das ist ein Test mit mehreren Wörtern'), false)
  assert.equal(looksEnglish('12345'), true, 'no letters is not a claim about a language')
  assert.equal(looksEnglish(''), true)
})

test('tidyLight edge cases and idempotence', () => {
  assert.equal(tidyLight(''), '')
  assert.equal(tidyLight('   '), '')
  assert.equal(tidyLight('um'), '', 'a lone filler leaves nothing')
  for (const sample of [
    'um so I think we should go to example.com, you know, tomorrow',
    'first, milk. second, eggs.',
    'meet at three, no, I mean four'
  ]) {
    const once = tidyLight(sample)
    assert.equal(tidyLight(once), once, `idempotent: ${sample}`)
  }
})

test('normalizeCaseAndPunctuation keeps bullet lines free of full stops', () => {
  assert.equal(normalizeCaseAndPunctuation('list:\n- milk\n- eggs'), 'List:\n- Milk\n- Eggs')
  assert.equal(normalizeCaseAndPunctuation('done'), 'Done.')
})
