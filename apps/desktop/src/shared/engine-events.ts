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
/** renderer → main (Windows): capture readiness, drain, and error acknowledgements. */
export const ENGINE_CAPTURE_STATUS_CHANNEL = 'engine:capture-status'
/** main → renderer (Windows): decode an imported file with Chromium's media stack. */
export const ENGINE_BATCH_CONTROL_CHANNEL = 'engine:batch-control'
/** renderer → main (Windows): decoded PCM lifecycle for an imported file. */
export const ENGINE_BATCH_DATA_CHANNEL = 'engine:batch-data'
/** renderer → main (invoke, Windows): read the file assigned to a batch job. */
export const ENGINE_BATCH_READ_CHANNEL = 'engine:batch-read'

export interface EngineCaptureControl {
  action: 'start' | 'stop' | 'switch-input'
  /** Identifies one live capture so delayed callbacks cannot cross session boundaries. */
  sessionId: number
  channels?: string[]
  inputDevice?: string
}

export type EngineCaptureStatus =
  | { type: 'ready' | 'drained' | 'switch-complete'; sessionId: number }
  | { type: 'error' | 'switch-error'; sessionId: number; message: string }

export interface EngineBatchControl {
  action: 'decode'
  jobId: string
}

export type EngineBatchMessage =
  | {
      type: 'begin'
      jobId: string
      channels: EngineChannel[]
      audioSeconds: number
    }
  | { type: 'audio'; jobId: string; channel: EngineChannel; samples: Float32Array }
  | { type: 'end'; jobId: string }
  | { type: 'error'; jobId: string; message: string }

export const ENGINE_EVENT_CHANNEL = 'engine:event'
export const ENGINE_START_CHANNEL = 'engine:start'
export const ENGINE_STOP_CHANNEL = 'engine:stop'
/** renderer → main (invoke): list audio input devices (macOS engine). */
export const ENGINE_LIST_DEVICES_CHANNEL = 'engine:list-devices'
/** renderer → main: switch the mic channel's input device (mid-session too). */
export const ENGINE_SET_INPUT_CHANNEL = 'engine:set-input'
/** renderer → main (invoke): verify the Core Audio tap hears audio. */
export const ENGINE_TAP_SELFTEST_CHANNEL = 'engine:tap-selftest'

/** One selectable audio input device (macOS: CoreAudio UID + name). */
export interface EngineInputDevice {
  uid: string
  name: string
  /** True for the current system default input. */
  isDefault: boolean
}

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
  /** live only (macOS): CoreAudio UID of the mic to record from; omit = system default. */
  inputDevice?: string
  /** live only: the meeting this session records into (keys audio persistence). */
  meetingId?: string
  /** live only: false disables saving the meeting audio (user setting). */
  persistAudio?: boolean
  /**
   * live only: engine session directory for checkpoint audio. Set by the
   * main process from meetingId + persistAudio — never by the renderer.
   */
  audioDir?: string
  /** live only (macOS): system-audio capture backend; default 'sck'. */
  systemBackend?: 'sck' | 'tap'
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

/** Windows: high-accuracy local text for each channel after live capture stops. */
export interface EngineRefinedEvent {
  event: 'refined'
  transcripts: Array<{ channel: EngineChannel; text: string; audioSeconds?: number }>
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

/** The session's audio was merged and saved to disk (emitted before done). */
export interface EngineAudioEvent {
  event: 'audio'
  /** Absolute path of the merged audio.m4a. */
  path: string
  durationMs: number
  /** Wall-clock ms of the file's first frame; 0 when unknown. */
  startEpochMs?: number
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
  | EngineRefinedEvent
  | EngineErrorEvent
  | EngineDoneEvent
  | EngineChannelStartEvent
  | EngineAudioEvent

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
// The segment shape now lives in @repo/meetings-store (shared with the MCP
// server and connectors); its MeetingChannel is the same 'mic' | 'system'
// union as EngineChannel. Re-exported here so engine-facing code keeps its
// existing import path.
export type { TranscriptSegment } from '@repo/meetings-store/types'
import type { TranscriptSegment } from '@repo/meetings-store/types'

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

/** Atomic replacement of the provisional live segments after local refinement. */
export interface EngineSegmentsReplacedEvent {
  event: 'segments-replaced'
  segments: TranscriptSegment[]
}

export type EngineLifecycleEvent =
  | EngineStartedEvent
  | EngineSpawnErrorEvent
  | EngineExitEvent
  | EngineSegmentsEvent
  | EngineSegmentsReplacedEvent
  | EngineSessionSavedEvent

/** Everything the renderer can receive on ENGINE_EVENT_CHANNEL. */
export type EngineEvent = EngineSidecarEvent | EngineLifecycleEvent

/** API surface exposed on `window.engine` by the preload script. */
export interface EngineApi {
  start(command: EngineCommand, filePath?: string, opts?: EngineStartOptions): void
  stop(): void
  onEvent(cb: (event: EngineEvent) => void): () => void
  /** Audio input devices for the mic picker; [] where unsupported (Windows). */
  listInputDevices(): Promise<EngineInputDevice[]>
  /** Switch the mic input; applies live when a session is recording. null = system default. */
  setInputDevice(uid: string | null): void
  /** Run the tap self-test (macOS): does the no-screen-permission backend hear audio? */
  tapSelfTest(): Promise<{ ok: boolean; reason?: string }>
  /** Windows capture bridge (no-ops on macOS). */
  onCaptureControl(cb: (control: EngineCaptureControl) => void): () => void
  sendAudio(sessionId: number, channel: string, samples: Float32Array): void
  reportCaptureStatus(status: EngineCaptureStatus): void
  /** Windows imported-audio decoder bridge (no events are sent on macOS). */
  onBatchControl(cb: (control: EngineBatchControl) => void): () => void
  readBatchAudio(jobId: string): Promise<ArrayBuffer>
  sendBatchMessage(message: EngineBatchMessage): Promise<void>
}
