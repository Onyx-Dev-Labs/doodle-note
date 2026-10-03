import type { CalendarStartMeetingEvent } from './calendar-api'

export const RECORDING_REQUEST_CHANNEL = 'recording:request'
export const RECORDING_READY_CHANNEL = 'recording:ready'
export const RECORDING_DELIVER_CHANNEL = 'recording:deliver'
export const RECORDING_ATTACH_CHANNEL = 'recording:attach'
export const RECORDING_CANCEL_CHANNEL = 'recording:cancel'
export const RECORDING_JOIN_RETRY_CHANNEL = 'recording:join-retry'
export const RECORDING_JOIN_DISMISS_CHANNEL = 'recording:join-dismiss'
export const RECORDING_STATE_CHANNEL = 'recording:state'
export type RecordingPhase = 'idle' | 'requested' | 'starting' | 'recording' | 'finishing'
export interface RecordingJoinState {
  requestId: string
  subject: string
  status: 'opening' | 'failed' | 'opened'
}
export interface RecordingState {
  join?: RecordingJoinState
  phase: RecordingPhase
  eligible: boolean
  meetingId: string | null
}
export interface RecordingStartRequest {
  id: string
  event: CalendarStartMeetingEvent
}
export interface RecordingApi {
  retryJoin(requestId: string): Promise<void>
  dismissJoin(requestId: string): Promise<void>
  requestStart(event?: CalendarStartMeetingEvent): Promise<boolean>
  ready(eligible: boolean): Promise<RecordingState>
  attach(requestId: string, meetingId: string): Promise<boolean>
  cancel(requestId: string): Promise<void>
  onStart(cb: (request: RecordingStartRequest) => void): () => void
  onState(cb: (state: RecordingState) => void): () => void
}
