/**
 * Slow-machine guard for Windows live captions.
 *
 * The live engine decodes every utterance with Parakeet TDT 0.6b; interim
 * caption updates re-decode the utterance in progress and are the only
 * optional work. At startup the engine decodes a fixed 4-second signal and
 * measures the real-time factor (decode seconds per audio second) with the
 * live thread budget. On a machine where that cost leaves too little room for
 * two simultaneous speakers plus interim updates, captions switch to
 * utterance-only updates: committed text still follows each pause, and no
 * audio is skipped. At run time the pipeline also skips interim decodes when
 * recent decode load or lag is high, and the engine reports `captions_delayed`
 * if a channel still falls more than five seconds behind capture.
 */

export type LiveCaptionMode = 'interim' | 'utterance'

/**
 * Above this calibration RTF, interim updates are turned off. Measured on
 * ODL-WIN-Dev04 (i7-10700T): ~0.10 with two threads, while interim updates
 * roughly triple decode work for continuous speech. 0.2 keeps two-channel
 * interim captions below half of real time.
 */
export const INTERIM_MAX_CALIBRATION_RTF = 0.2

export function liveCaptionMode(calibrationRtf: number): LiveCaptionMode {
  return Number.isFinite(calibrationRtf) && calibrationRtf <= INTERIM_MAX_CALIBRATION_RTF
    ? 'interim'
    : 'utterance'
}

/** Deterministic 4 s low-level noise; encoder cost does not depend on content. */
export function calibrationSignal(seconds = 4): Float32Array {
  const samples = new Float32Array(Math.round(seconds * 16_000))
  let state = 0x2545f491
  for (let i = 0; i < samples.length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    samples[i] = ((state >>> 0) / 0xffffffff - 0.5) * 0.02
  }
  return samples
}
