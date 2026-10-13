import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  initialEndState,
  initialMicState,
  markEnded,
  markPrompted,
  MEETING_END_DEBOUNCE_MS,
  meetingAppLabel,
  meetingPromptLabel,
  MIC_COOLDOWN_MS,
  MIC_DEBOUNCE_MS,
  MIC_SESSION_GAP_MS,
  onCaptureMicEvent,
  onMicEvent,
  setSuppressed,
  shouldAutoStop,
  shouldPrompt
} from './mic-watcher-logic'

const T0 = 1_000_000

describe('mic-watcher-logic', () => {
  it('prompts only after the debounce window', () => {
    const s = onMicEvent(initialMicState(), true, T0)
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

  it('a short idle stays in the session and the cooldown still applies', () => {
    let s = onMicEvent(initialMicState(), true, T0)
    s = markPrompted(s, T0 + MIC_DEBOUNCE_MS)
    s = onMicEvent(s, false, T0 + 60_000) // hang up
    s = onMicEvent(s, true, T0 + 70_000) // new call right away
    assert.equal(shouldPrompt(s, T0 + 70_000 + MIC_DEBOUNCE_MS), false) // inside cooldown
    // The same busy stretch remains quiet even after the wall-clock cooldown.
    assert.equal(shouldPrompt(s, T0 + MIC_DEBOUNCE_MS + MIC_COOLDOWN_MS + 1), false)
  })

  it('does not re-prompt when the mic reconnects during the same meeting', () => {
    let s = onMicEvent(initialMicState(), true, T0)
    s = markPrompted(s, T0 + MIC_DEBOUNCE_MS)
    // Drop late enough that the ordinary five-minute cooldown will expire
    // before the reconnect; the session-gap guard must still keep it quiet.
    s = onMicEvent(s, false, T0 + 4 * 60_000 + 30_000)
    const reconnect = T0 + 4 * 60_000 + 30_000 + MIC_SESSION_GAP_MS - 1
    s = onMicEvent(s, true, reconnect)
    assert.equal(shouldPrompt(s, reconnect + MIC_DEBOUNCE_MS), false)
  })

  it('allows a later call after the reconnect window and cooldown', () => {
    let s = onMicEvent(initialMicState(), true, T0)
    s = markPrompted(s, T0 + MIC_DEBOUNCE_MS)
    s = onMicEvent(s, false, T0 + 60_000)
    const nextCall = T0 + MIC_DEBOUNCE_MS + MIC_COOLDOWN_MS + MIC_SESSION_GAP_MS
    s = onMicEvent(s, true, nextCall)
    assert.equal(shouldPrompt(s, nextCall + MIC_DEBOUNCE_MS), true)
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

  it('recognizes Windows ConsentStore key names (exe paths + package families)', () => {
    // NonPackaged keys are exe paths with '#' for '\', lowercased by win-micmon.
    assert.equal(meetingAppLabel(['c:#users#sean#appdata#roaming#zoom#bin#zoom.exe']), 'Zoom')
    // New Teams is a Store app — package family name.
    assert.equal(meetingAppLabel(['msteams_8wekyb3d8bbwe']), 'Teams')
    assert.equal(meetingAppLabel(['c:#program files#slack#slack.exe']), 'Slack')
    assert.equal(
      meetingAppLabel(['c:#program files#google#chrome#application#chrome.exe']),
      'browser'
    )
    // DoodleNote's own capture shows up in the ConsentStore — never a meeting.
    assert.equal(meetingAppLabel(['c:#program files#doodlenote#doodlenote.exe']), null)
    assert.equal(meetingAppLabel(['c:#program files#microsoft#edge#msedge.exe']), 'browser')
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

describe('meeting-end watch', () => {
  const T0 = 5_000_000

  it('stops after the meeting app stays off the mic past the debounce', () => {
    let s = onCaptureMicEvent(initialEndState(), true, T0) // Zoom on mic
    s = onCaptureMicEvent(s, false, T0 + 60_000) // call ended
    assert.equal(shouldAutoStop(s, T0 + 60_000 + MEETING_END_DEBOUNCE_MS - 1), false)
    assert.equal(shouldAutoStop(s, T0 + 60_000 + MEETING_END_DEBOUNCE_MS), true)
  })

  it('a reconnect inside the debounce cancels the stop', () => {
    let s = onCaptureMicEvent(initialEndState(), true, T0)
    s = onCaptureMicEvent(s, false, T0 + 60_000)
    s = onCaptureMicEvent(s, true, T0 + 65_000) // network blip, back on
    assert.equal(shouldAutoStop(s, T0 + 60_000 + MEETING_END_DEBOUNCE_MS + 1), false)
  })

  it('mic-only recordings (no meeting app ever) never auto-stop', () => {
    let s = onCaptureMicEvent(initialEndState(), false, T0)
    s = onCaptureMicEvent(s, false, T0 + 120_000)
    assert.equal(shouldAutoStop(s, T0 + 600_000), false)
  })

  it('joining the call mid-recording still arms the end watch', () => {
    let s = onCaptureMicEvent(initialEndState(), false, T0) // recording alone
    s = onCaptureMicEvent(s, true, T0 + 30_000) // joins Zoom late
    s = onCaptureMicEvent(s, false, T0 + 90_000)
    assert.equal(shouldAutoStop(s, T0 + 90_000 + MEETING_END_DEBOUNCE_MS), true)
  })

  it('fires at most once per capture', () => {
    let s = onCaptureMicEvent(initialEndState(), true, T0)
    s = onCaptureMicEvent(s, false, T0 + 10_000)
    s = markEnded(s)
    assert.equal(shouldAutoStop(s, T0 + 10 * 60_000), false)
  })
})

describe('meetingPromptLabel', () => {
  for (const [bundle, label] of [
    ['com.tinyspeck.slackmacgap.helper', 'Slack'],
    ['us.zoom.xos', 'Zoom'],
    ['com.microsoft.teams2', 'Teams']
  ]) {
    it(`recognizes ${label} input while the default microphone is idle`, () => {
      assert.equal(
        meetingPromptLabel({ inputRunning: false, inputBundles: [bundle], outputBundles: [] }),
        label
      )
    })
  }

  it('requires recognized input attribution regardless of default-device activity', () => {
    for (const inputRunning of [false, true]) {
      for (const inputBundles of [[], ['com.electron.wispr-flow.helper'], ['unknown.app']]) {
        assert.equal(
          meetingPromptLabel({
            inputRunning,
            inputBundles,
            outputBundles: [
              'us.zoom.ZoomPhone',
              'com.tinyspeck.slackmacgap.helper',
              'com.hnc.Discord.helper',
              'com.google.Chrome.helper'
            ]
          }),
          null
        )
      }
    }
  })

  it('never promotes output-only audio into a recording prompt', () => {
    assert.equal(
      meetingPromptLabel({
        inputRunning: false,
        inputBundles: [],
        outputBundles: ['us.zoom.ZoomPhone']
      }),
      null
    )
    assert.equal(
      meetingPromptLabel({
        inputRunning: false,
        inputBundles: [],
        outputBundles: ['com.tinyspeck.slackmacgap.helper', 'com.hnc.Discord.helper']
      }),
      null
    )
  })

  it('still recognizes a meeting app that is actively using the microphone', () => {
    assert.equal(
      meetingPromptLabel({
        inputRunning: true,
        inputBundles: ['us.zoom.xos'],
        outputBundles: ['us.zoom.xos']
      }),
      'Zoom'
    )
  })
})
