import type { MeetingRecord } from "@repo/meetings-store";
import { contentHashOf, isFinalized } from "./event";
import type { ConnectorStateMap, DeliveryState } from "./types";

/**
 * Pure dispatch planning: given the current store contents and persisted
 * delivery state, decide which (connector, meeting) deliveries to attempt
 * right now. The host app owns timers, persistence, and actually calling
 * connectors — keeping this pure makes idempotency testable.
 */

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;
/** Give up after this many consecutive failures of the same snapshot. */
export const MAX_ATTEMPTS = 8;

export interface PlannedDelivery {
  connectorId: string;
  meetingId: string;
  contentHash: string;
}

export function planDeliveries(input: {
  records: MeetingRecord[];
  state: ConnectorStateMap;
  connectorIds: string[];
  now: number;
}): PlannedDelivery[] {
  const planned: PlannedDelivery[] = [];
  for (const record of input.records) {
    if (!isFinalized(record)) continue;
    const hash = contentHashOf(record);
    for (const connectorId of input.connectorIds) {
      const state = input.state[connectorId]?.[record.id];
      if (!needsDelivery(state, hash, input.now)) continue;
      planned.push({ connectorId, meetingId: record.id, contentHash: hash });
    }
  }
  return planned;
}

function needsDelivery(
  state: DeliveryState | undefined,
  hash: string,
  now: number,
): boolean {
  if (!state) return true;
  if (state.deliveredHash === hash) return false; // already delivered, unchanged
  if (state.attemptHash !== hash) return true; // content changed — fresh attempt
  if (state.attempts >= MAX_ATTEMPTS) return false; // exhausted; needs new content or manual retry
  return state.nextAttemptAt === undefined || now >= state.nextAttemptAt;
}

export function recordSuccess(
  state: ConnectorStateMap,
  delivery: PlannedDelivery,
  now: number,
): ConnectorStateMap {
  return withEntry(state, delivery, {
    deliveredHash: delivery.contentHash,
    deliveredAt: new Date(now).toISOString(),
    attempts: 0,
  });
}

export function recordFailure(
  state: ConnectorStateMap,
  delivery: PlannedDelivery,
  error: string,
  retryable: boolean,
  now: number,
): ConnectorStateMap {
  const prev = state[delivery.connectorId]?.[delivery.meetingId];
  const attempts =
    (prev?.attemptHash === delivery.contentHash ? (prev?.attempts ?? 0) : 0) +
    1;
  return withEntry(state, delivery, {
    ...(prev?.deliveredHash ? { deliveredHash: prev.deliveredHash } : {}),
    ...(prev?.deliveredAt ? { deliveredAt: prev.deliveredAt } : {}),
    attemptHash: delivery.contentHash,
    attempts: retryable ? attempts : MAX_ATTEMPTS,
    nextAttemptAt: now + backoffMs(attempts),
    lastError: error,
  });
}

/** Clear failure bookkeeping so an exhausted meeting is retried on demand. */
export function resetFailures(
  state: ConnectorStateMap,
  connectorId: string,
): ConnectorStateMap {
  const forConnector = state[connectorId];
  if (!forConnector) return state;
  const cleared: Record<string, DeliveryState> = {};
  for (const [meetingId, entry] of Object.entries(forConnector)) {
    cleared[meetingId] = entry.deliveredHash
      ? {
          deliveredHash: entry.deliveredHash,
          deliveredAt: entry.deliveredAt,
          attempts: 0,
        }
      : { attempts: 0 };
  }
  return { ...state, [connectorId]: cleared };
}

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

function withEntry(
  state: ConnectorStateMap,
  delivery: PlannedDelivery,
  entry: DeliveryState,
): ConnectorStateMap {
  return {
    ...state,
    [delivery.connectorId]: {
      ...(state[delivery.connectorId] ?? {}),
      [delivery.meetingId]: entry,
    },
  };
}

/** Summary the Settings UI shows per connector. */
export function connectorStatus(
  state: ConnectorStateMap,
  connectorId: string,
): { delivered: number; pending: number; failed: number; lastError?: string } {
  const entries = Object.values(state[connectorId] ?? {});
  const failed = entries.filter((e) => e.attempts >= MAX_ATTEMPTS);
  const pending = entries.filter(
    (e) => e.attempts > 0 && e.attempts < MAX_ATTEMPTS,
  );
  const lastError = [...entries].reverse().find((e) => e.lastError)?.lastError;
  return {
    delivered: entries.filter((e) => e.deliveredHash).length,
    pending: pending.length,
    failed: failed.length,
    ...(lastError ? { lastError } : {}),
  };
}
