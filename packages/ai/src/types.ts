/** A transcript segment as produced by the desktop segment pipeline. */
export interface MergeSegment {
  speaker: 'You' | 'Them'
  text: string
  startMs: number
}

/** Everything the note-merge needs about one meeting. */
export interface MergeInput {
  title?: string
  /** The user's rough notes, as markdown (TipTap serializes to this). */
  rawNotesMarkdown: string
  segments: MergeSegment[]
  durationMs?: number
}

export interface MergedNotes {
  /** Polished meeting notes as markdown; TipTap renders this into the editor. */
  markdown: string
  engine: string
  elapsedMs: number
}

/**
 * A notes engine turns a meeting (rough notes + transcript) into polished
 * notes. Doodle Note ships two: the LOCAL engine (default — an on-device
 * model downloaded during onboarding) and cloud engines behind the user's
 * own API key (optional, added in settings).
 */
export interface NotesEngine {
  id: string
  label: string
  generateNotes(input: MergeInput, onToken?: (text: string) => void): Promise<MergedNotes>
}
