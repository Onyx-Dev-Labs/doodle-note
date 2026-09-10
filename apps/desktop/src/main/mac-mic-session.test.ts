import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { macMicPromptDelay, updateMacMicSession, type MacMicSession } from './mac-mic-session'

const update = updateMacMicSession

describe('macOS microphone call continuity', () => {
  for (const label of ['Teams', 'Zoom', 'browser']) {
    it(`${label}: prompts for distinct calls within five minutes`, () => {
      let state = update(null, label, [label], 0, false)!
      assert.equal(macMicPromptDelay(state, 3999), 1)
      assert.equal(macMicPromptDelay(state, 4000), 0)
      state = { ...state, prompted: true }
      state = update(state, null, [], 6000, false)!
      state = update(state, label, [label], 8500, false)!
      assert.equal(state.startedAtMs, 8500)
      assert.equal(macMicPromptDelay(state, 12500), 0)
    })
  }
  it('never starts a session from rings or browser media output alone', () => {
    assert.equal(update(null, null, ['Zoom', 'Teams', 'browser'], 5000, false), null)
  })
  it('keeps a muted call with output and a brief full reconnect in the same session', () => {
    let state: MacMicSession = {
      ...update(null, 'browser', ['browser'], 0, false)!,
      prompted: true
    }
    state = update(state, null, ['browser'], 5000, false)!
    state = update(state, 'browser', ['browser'], 600000, false)!
    assert.equal(macMicPromptDelay(state, 604000), null)
    state = update(state, null, [], 610000, false)!
    state = update(state, 'browser', [], 611999, false)!
    assert.equal(state.startedAtMs, 0)
    assert.equal(macMicPromptDelay(state, 616000), null)
  })
  it('does not restart the input debounce for unrelated output changes', () => {
    let state = update(null, 'Teams', [], 0, false)
    state = update(state, 'Teams', ['browser'], 2000, false)
    state = update(state, 'Teams', ['Teams'], 3999, false)
    assert.equal(macMicPromptDelay(state, 4000), 0)
  })
  it('consumes calls detected during recording and does not re-prompt after Stop', () => {
    let state = update(null, 'Zoom', [], 0, true)
    state = update(state, 'Zoom', [], 6000, false)
    assert.equal(macMicPromptDelay(state, 10000), null)
    state = update(state, null, [], 11000, false)
    state = update(state, 'Zoom', [], 14000, false)
    assert.equal(macMicPromptDelay(state, 18000), 0)
  })
})
