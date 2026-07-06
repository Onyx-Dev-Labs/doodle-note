import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  initialMicState,
  markPrompted,
  meetingAppLabel,
  MIC_COOLDOWN_MS,
  MIC_DEBOUNCE_MS,
  onMicEvent,
  setSuppressed,
  shouldPrompt
} from './mic-watcher-logic'

const T0 = 1_000_000

describe('mic-watcher-logic', () => {
  it('prompts only after the debounce window', () => {
    let s = onMicEvent(initialMicState(), true, T0)
    assert.equal(shouldPrompt(s, T0 + MIC_DEBOUNCE_MS - 1), false)
    assert.equal(shouldPrompt(s, T0 + MIC_DEBOUNCE_MS), true)
  })

  it('keeps the original busy start across repeated running=true events', () => {
    let s = onMicEvent(initialMicState(), true, T0)
    s = onMicEvent(s, true, T0 + 5_000)
    assert.equal(shouldPrompt(s, T0 + MIC_DEBOUNCE_MS), true)
  })

  it('never prompts twice for one continuous busy stretch', () => {
    let s = onMicEvent(initialMicState(), true, T0)
    s = markPrompted(s, T0 + MIC_DEBOUNCE_MS)
    assert.equal(shouldPrompt(s, T0 + MIC_DEBOUNCE_MS + 60_000), false)
  })

  it('idle resets the session but cooldown still applies', () => {
    let s = onMicEvent(initialMicState(), true, T0)
    s = markPrompted(s, T0 + MIC_DEBOUNCE_MS)
    s = onMicEvent(s, false, T0 + 60_000) // hang up
    s = onMicEvent(s, true, T0 + 70_000) // new call right away
    assert.equal(shouldPrompt(s, T0 + 70_000 + MIC_DEBOUNCE_MS), false) // inside cooldown
    const afterCooldown = T0 + MIC_DEBOUNCE_MS + MIC_COOLDOWN_MS
    s = onMicEvent(s, false, afterCooldown - 20_000)
    s = onMicEvent(s, true, afterCooldown - 10_000)
    assert.equal(shouldPrompt(s, afterCooldown + 1), true)
  })

  it('short blips (Siri, dictation) never fire', () => {
    let s = onMicEvent(initialMicState(), true, T0)
    s = onMicEvent(s, false, T0 + 3_000)
    assert.equal(shouldPrompt(s, T0 + MIC_DEBOUNCE_MS), false)
  })

  it('recognizes meeting apps by bundle id, ignores everything else', () => {
    assert.equal(meetingAppLabel(['us.zoom.xos']), 'Zoom')
    assert.equal(meetingAppLabel(['com.microsoft.teams2']), 'Teams')
    assert.equal(meetingAppLabel(['com.google.Chrome.helper']), 'browser')
    // Dictation tools hold the mic all day — never a meeting.
    assert.equal(meetingAppLabel(['com.fluidvoice.app']), null)
    assert.equal(meetingAppLabel(['com.apple.VoiceMemos']), null)
    // No attribution (macOS < 14.4) stays conservative.
    assert.equal(meetingAppLabel([]), null)
    // A meeting app among others still wins.
    assert.equal(meetingAppLabel(['com.fluidvoice.app', 'us.zoom.xos']), 'Zoom')
  })

  it('suppression swallows events and requires a fresh edge after lifting', () => {
    let s = setSuppressed(initialMicState(), true)
    s = onMicEvent(s, true, T0) // our own capture holding the mic
    assert.equal(shouldPrompt(s, T0 + MIC_DEBOUNCE_MS), false)
    // Capture ends but the meeting app STILL holds the mic — no busy edge yet.
    s = setSuppressed(s, false)
    assert.equal(shouldPrompt(s, T0 + 2 * MIC_DEBOUNCE_MS), false)
    // Fresh idle→busy edge after unsuppression is trusted again.
    s = onMicEvent(s, true, T0 + 60_000)
    assert.equal(shouldPrompt(s, T0 + 60_000 + MIC_DEBOUNCE_MS), true)
  })
})
