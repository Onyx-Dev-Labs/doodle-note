export type MeetingPrimaryAction =
  'hidden' | 'generate' | 'generating' | 'transcribe' | 'transcribing' | 'configure-model'

export interface MeetingPrimaryActionInput {
  capturing: boolean
  segmentCount: number
  audioPartCount: number
  modelReady: boolean
  enhancedPresent: boolean
  generating: boolean
  retranscribing: boolean
}

/** Resolve the meeting CTA so recovery and setup states stay actionable. */
export function meetingPrimaryAction(input: MeetingPrimaryActionInput): MeetingPrimaryAction {
  if (input.capturing || input.enhancedPresent) return 'hidden'
  if (input.segmentCount === 0) {
    if (input.audioPartCount === 0) return 'hidden'
    return input.retranscribing ? 'transcribing' : 'transcribe'
  }
  if (input.generating) return 'generating'
  if (!input.modelReady) return 'configure-model'
  return 'generate'
}

export type TranscriptCheckpointPhase = 'idle' | 'starting' | 'recording' | 'finishing' | 'ended'

/** Delay before the renderer persists the transcript for the current phase. */
export function transcriptCheckpointDelayMs(
  phase: TranscriptCheckpointPhase,
  segmentCount: number
): number | null {
  if (segmentCount === 0) return null
  if (phase === 'recording') return 1_000
  if (phase === 'finishing') return 400
  if (phase === 'ended') return 0
  return null
}

/** Providers whose encrypted settings can be restored after an app restart. */
export function isStoredCloudProvider(
  value: unknown
): value is 'anthropic' | 'openai' | 'groq' | 'openrouter' | 'ollama' {
  return (
    value === 'anthropic' ||
    value === 'openai' ||
    value === 'groq' ||
    value === 'openrouter' ||
    value === 'ollama'
  )
}
