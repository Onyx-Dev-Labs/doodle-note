import { MIC_DEBOUNCE_MS } from './mic-watcher-logic'

/** Both call input and output must disappear; short audio-route jitter is ignored. */
export const MAC_CALL_GAP_MS = 2_000

export interface MacMicSession {
  label: string
  startedAtMs: number
  busySinceMs: number | null
  absentSinceMs: number | null
  prompted: boolean
}

/** Output can preserve a mic-confirmed call across mute, but never starts one.
 * CoreAudio identifies apps, not meeting URLs: two calls with uninterrupted
 * audio in the same browser cannot be distinguished by these signals. */
export function updateMacMicSession(
  previous: MacMicSession | null,
  inputLabel: string | null,
  outputLabels: readonly string[],
  nowMs: number,
  recording: boolean
): MacMicSession | null {
  let session = previous
  if (session?.absentSinceMs != null && nowMs - session.absentSinceMs >= MAC_CALL_GAP_MS) {
    session = null
  }
  if (inputLabel !== null) {
    if (!session || session.label !== inputLabel) {
      return {
        label: inputLabel,
        startedAtMs: nowMs,
        busySinceMs: nowMs,
        absentSinceMs: null,
        prompted: recording
      }
    }
    return {
      ...session,
      busySinceMs: session.busySinceMs ?? nowMs,
      absentSinceMs: null,
      prompted: session.prompted || recording
    }
  }
  if (!session) return null
  return {
    ...session,
    busySinceMs: null,
    absentSinceMs: outputLabels.includes(session.label) ? null : (session.absentSinceMs ?? nowMs),
    prompted: session.prompted || recording
  }
}

export function macMicPromptDelay(session: MacMicSession | null, nowMs: number): number | null {
  if (!session || session.prompted || session.busySinceMs === null) return null
  return Math.max(0, session.busySinceMs + MIC_DEBOUNCE_MS - nowMs)
}
