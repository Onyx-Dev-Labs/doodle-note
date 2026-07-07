/**
 * Shared engine sidecar types, used by main + preload + renderer.
 *
 * The sidecar (engine/.build/release/engine) emits NDJSON on stdout:
 * one JSON object per line, discriminated by the "event" field.
 * Protocol reference: engine/README.md.
 */

/** main → renderer (Windows): start/stop microphone + loopback capture. */
export const ENGINE_CAPTURE_CONTROL_CHANNEL = 'engine:capture-control'
/** renderer → main (Windows): one 16k mono Float32 frame for a channel. */
export const ENGINE_AUDIO_CHANNEL = 'engine:audio'
/** renderer → main (Windows): capture could not start (permissions etc.). */
export const ENGINE_CAPTURE_ERROR_CHANNEL = 'engine:capture-error'

export interface EngineCaptureControl {
  action: 'start' | 'stop'
  channels?: string[]
}

export const ENGINE_EVENT_CHANNEL = 'engine:event'
export const ENGINE_START_CHANNEL = 'engine:start'
export const ENGINE_STOP_CHANNEL = 'engine:stop'

export type EngineCommand = 'stream' | 'transcribe' | 'live'

/** Live capture channels: mic = the local user, system = the far side of the call. */
export type EngineChannel = 'mic' | 'system'

export interface EngineStartOptions {
  realtime?: boolean
  /** e.g. "v2" | "v3" */
  model?: string
  /** live only: which capture sources (default "both") */
  source?: 'mic' | 'system' | 'both'
  /** live only: auto-stop after N seconds (dev/testing) */
  seconds?: number
}

export interface EngineStartRequest {
  command: EngineCommand
  /** Required for stream/transcribe; unused for live. */
  filePath?: string
  opts?: EngineStartOptions
}

/* ---- Events emitted by the sidecar itself (parsed from stdout NDJSON) ---- */

export interface EngineStatusEvent {
  event: 'status'
  model?: string
  stage?: string
  channel?: EngineChannel
  /** Present when stage === "requesting_permission". */
  permission?: string
}

export interface EngineDownloadEvent {
  event: 'download'
  /** 0..1 */
  progress: number
}

export interface EngineReadyEvent {
  event: 'ready'
  model?: string
  /** live mode: channels that are capturing */
  channels?: EngineChannel[]
  mode?: string
}

export interface EnginePartialEvent {
  event: 'partial'
  text: string
  /** Present in live mode. */
  channel?: EngineChannel
}

export interface EngineTokenTiming {
  token: string
  startSec: number
  endSec: number
  confidence: number
}

export interface EngineTimingsEvent {
  event: 'timings'
  tokens: EngineTokenTiming[]
  /** Present in live mode. */
  channel?: EngineChannel
}

export interface EngineFinalEvent {
  event: 'final'
  text: string
  channel?: EngineChannel
  confidence?: number
  audioSeconds?: number
  processingSeconds?: number
  speedup?: number
  /** live mode: wall-clock length of the capture session */
  sessionSeconds?: number
  tokens?: EngineTokenTiming[]
}

export interface EngineErrorEvent {
  event: 'error'
  message: string
  channel?: EngineChannel
}

/** Live session fully finished (all channels final). */
export interface EngineDoneEvent {
  event: 'done'
}

/** Live: wall-clock anchor for a channel's token timeline (first audio buffer). */
export interface EngineChannelStartEvent {
  event: 'channel_start'
  channel: EngineChannel
  epochMs: number
}

export type EngineSidecarEvent =
  | EngineStatusEvent
  | EngineDownloadEvent
  | EngineReadyEvent
  | EnginePartialEvent
  | EngineTimingsEvent
  | EngineFinalEvent
  | EngineErrorEvent
  | EngineDoneEvent
  | EngineChannelStartEvent

/* ---- Lifecycle events synthesized by the main process ---- */

export interface EngineStartedEvent {
  event: 'started'
  command: EngineCommand
  filePath?: string
  /** Resolved sidecar binary path (useful for debugging). */
  binaryPath: string
}

export interface EngineSpawnErrorEvent {
  event: 'spawn-error'
  message: string
}

export interface EngineExitEvent {
  event: 'exit'
  code: number | null
  signal: string | null
}

/* ---- Transcript segments (assembled in the main process from timings) ---- */

/**
 * A contiguous stretch of one speaker's words, cut on pauses. The unit that
 * becomes a transcript_segments row in the database.
 */
export interface TranscriptSegment {
  id: string
  channel: EngineChannel
  speaker: 'You' | 'Them'
  text: string
  /** Milliseconds relative to this channel's stream start. */
  startMs: number
  endMs: number
  /** Mean token confidence 0..1. */
  confidence: number
  /** Wall-clock ms (channel epoch + startMs); present once channel_start arrived. */
  absoluteStartMs?: number
  /** True when the segment was judged to be far-side audio bleeding into the mic. */
  echo?: boolean
}

/** Newly completed segments (echo-flagged ones included; display layers filter). */
export interface EngineSegmentsEvent {
  event: 'segments'
  segments: TranscriptSegment[]
}

/** A finished live session was written to disk. */
export interface EngineSessionSavedEvent {
  event: 'session-saved'
  path: string
  segmentCount: number
}

export type EngineLifecycleEvent =
  | EngineStartedEvent
  | EngineSpawnErrorEvent
  | EngineExitEvent
  | EngineSegmentsEvent
  | EngineSessionSavedEvent

/** Everything the renderer can receive on ENGINE_EVENT_CHANNEL. */
export type EngineEvent = EngineSidecarEvent | EngineLifecycleEvent

/** API surface exposed on `window.engine` by the preload script. */
export interface EngineApi {
  start(command: EngineCommand, filePath?: string, opts?: EngineStartOptions): void
  stop(): void
  onEvent(cb: (event: EngineEvent) => void): () => void
  /** Windows capture bridge (no-ops on macOS). */
  onCaptureControl(cb: (control: EngineCaptureControl) => void): () => void
  sendAudio(channel: string, samples: Float32Array): void
  reportCaptureError(message: string): void
}
