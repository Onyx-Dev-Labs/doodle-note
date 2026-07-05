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

/** One completed question/answer pair in a meeting's chat thread. */
export interface AskExchange {
  question: string
  answer: string
}

/** Everything the "ask anything" answer needs about one meeting. */
export interface AskInput {
  title?: string
  /** The user's rough notes, as markdown (TipTap serializes to this). */
  rawNotesMarkdown: string
  /** AI-generated notes, when an Enhance run already happened. */
  enhancedMarkdown?: string | null
  segments: MergeSegment[]
  /** Prior exchanges in this conversation (oldest first). */
  history: AskExchange[]
  question: string
}

/**
 * The engine's answer to an "ask anything" question — same shape as
 * MergedNotes (markdown payload + which engine + how long it took).
 */
export type AskAnswer = MergedNotes

/**
 * A notes engine turns a meeting (rough notes + transcript) into polished
 * notes, and answers questions about it. Doodle Note ships two: the LOCAL
 * engine (default — an on-device model downloaded during onboarding) and
 * cloud engines behind the user's own API key (optional, added in settings).
 */
export interface NotesEngine {
  id: string
  label: string
  generateNotes(input: MergeInput, onToken?: (text: string) => void): Promise<MergedNotes>
  /** Answer a question grounded ONLY in this meeting's content. */
  askQuestion(input: AskInput, onToken?: (text: string) => void): Promise<AskAnswer>
}
