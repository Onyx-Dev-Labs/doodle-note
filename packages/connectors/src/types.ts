/**
 * The connector/export contract: external knowledge systems (GBrain,
 * Obsidian, Notion, …) are optional DESTINATIONS that receive finalized
 * meetings. DoodleNote core knows only this interface — never a specific
 * connector — and connectors never reach back into core services.
 */

/** Snapshot of a finalized meeting, handed to connectors for delivery. */
export interface FinalizedMeetingEvent {
  schema_version: 1;
  meeting: {
    /** Stable DoodleNote meeting id (same id on every device and in the cloud). */
    id: string;
    kind: "meeting" | "note";
    title: string;
    created_at: string;
    started_at?: string;
    ended_at?: string;
    duration_min?: number;
    calendar_event_id?: string;
    /** Folder NAME (resolved by the host app); absent = unfiled. */
    folder?: string;
  };
  notes: {
    raw_markdown: string;
    /** Non-empty — a meeting is only "finalized" once notes were generated. */
    enhanced_markdown: string;
  };
  transcript: {
    segments: Array<{
      /** Display label: a real name when known, else "You" / "Them". */
      speaker: string;
      text: string;
      start_ms: number;
      end_ms: number;
    }>;
    /** Rendered "Speaker: text" lines. */
    text: string;
  };
  /** SHA-256 over the durable content; identical retries carry identical hashes. */
  content_hash: string;
  /** When this snapshot was taken (ISO). */
  finalized_at: string;
}

/** Thrown by connectors; `retryable` decides whether the dispatcher backs off and retries. */
export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface Connector<C = Record<string, unknown>> {
  /** Stable id, e.g. "gbrain". Used as the state-map key. */
  id: string;
  /**
   * Deliver one finalized meeting. MUST be idempotent — the dispatcher
   * retries on ConnectorError(retryable=true) and re-sends when content
   * changes, always with the content_hash the destination can upsert on.
   */
  deliver(event: FinalizedMeetingEvent, config: C): Promise<void>;
}

/** Per-(connector, meeting) delivery bookkeeping, persisted by the host app. */
export interface DeliveryState {
  /** Hash of the last successfully delivered snapshot. */
  deliveredHash?: string;
  deliveredAt?: string;
  /** Hash of the snapshot currently being attempted (resets attempts when it changes). */
  attemptHash?: string;
  attempts: number;
  /** Epoch ms before which no retry should run. */
  nextAttemptAt?: number;
  lastError?: string;
}

/** connectorId → meetingId → state. */
export type ConnectorStateMap = Record<string, Record<string, DeliveryState>>;
