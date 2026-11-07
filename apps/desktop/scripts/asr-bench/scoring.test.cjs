const assert = require('node:assert/strict')
const { test } = require('node:test')
const { normalize, score, aggregate } = require('./scoring.cjs')

test('case, punctuation and hesitations do not count as errors', () => {
  assert.deepEqual(normalize('Um, Well -- I DON’T know. Uh-huh!'), ['well', 'i', "don't", 'know'])
  const result = score('WELL I DONT KNOW', 'Well, I dont know.')
  assert.equal(result.errors, 0)
  assert.equal(result.hasCase, true)
  assert.equal(result.hasPunctuation, true)
})

test('numbers are spelled out the same way on both sides', () => {
  assert.deepEqual(normalize('749'), ['seven', 'hundred', 'forty', 'nine'])
  assert.deepEqual(normalize('10:30'), ['ten', 'thirty'])
  assert.deepEqual(normalize('In 1990 it cost $5, 25% more.'), [
    'in', 'nineteen', 'ninety', 'it', 'cost', 'five', 'dollars', 'twenty', 'five', 'percent', 'more'
  ])
  assert.deepEqual(normalize('the 2nd of 3.5'), ['the', 'second', 'of', 'three', 'point', 'five'])
  // Four-digit amounts from 1100 to 2099 read like years ("twelve hundred").
  assert.deepEqual(normalize('2005 and 1,200 and 12,500'), [
    'two', 'thousand', 'five', 'and', 'twelve', 'hundred', 'and', 'twelve', 'thousand', 'five', 'hundred'
  ])
  assert.deepEqual(normalize('OK alright'), ['okay', 'all', 'right'])
})

test('word errors are counted by type and aggregated over reference words', () => {
  const a = score('the cat sat on the mat', 'the cat sat on mat today')
  assert.equal(a.deletions + a.insertions + a.substitutions, a.errors)
  assert.equal(a.errors, 2)
  const b = score('hello world', 'hello word')
  assert.equal(b.substitutions, 1)
  const total = aggregate([a, b])
  assert.equal(total.refWords, 8)
  assert.equal(total.errors, 3)
  assert.equal(total.wer, 3 / 8)
})
