export { buildGlobalAskUserMessage, GLOBAL_ASK_SYSTEM_PROMPT } from './global-ask-prompt'
export type { GlobalAskInput, GlobalAskMeeting } from './global-ask-prompt'
export { ASK_SYSTEM_PROMPT, buildAskUserMessage } from './ask-prompt'
export { availableLocalModels, defaultLocalModel, LOCAL_MODELS, totalRamGB } from './catalog'
export type { LocalModelSpec } from './catalog'
export { CloudNotesEngine } from './cloud-engine'
export type { CloudEngineOptions } from './cloud-engine'
export { DEFAULT_MODELS_DIR, LocalNotesEngine } from './local-engine'
export type { LocalEngineOptions } from './local-engine'
export { buildMergeUserMessage, formatTranscript, MERGE_SYSTEM_PROMPT } from './prompt'
export { chunkSegments, DEFAULT_SINGLE_PASS_CHARS, generateMeetingNotes } from './map-reduce'
export type {
  AskAnswer,
  AskExchange,
  AskInput,
  MergedNotes,
  MergeInput,
  MergeSegment,
  NotesEngine,
  NotesProgress
} from './types'
export { NOTE_TEMPLATES, templateById, type NoteTemplate } from './templates'
