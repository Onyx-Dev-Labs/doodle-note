export interface StripeCancellationFields {
  cancelAt: number | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: number | null;
}

export type CancellationChange =
  | { kind: "scheduled"; scheduledFor: Date }
  | { kind: "revoked" }
  | { kind: "unchanged"; scheduledFor: Date | null };

export function subscriptionCancellationDate(
  subscription: StripeCancellationFields,
): Date | null {
  const timestamp =
    subscription.cancelAt ??
    (subscription.cancelAtPeriodEnd
      ? subscription.currentPeriodEnd ?? null
      : null);
  return timestamp ? new Date(timestamp * 1000) : null;
}

export function cancellationChange(
  current: StripeCancellationFields,
  previous: { cancel_at?: number | null; cancel_at_period_end?: boolean },
): CancellationChange {
  const scheduledFor = subscriptionCancellationDate(current);
  const previousWasScheduled =
    Boolean(previous.cancel_at) || previous.cancel_at_period_end === true;
  const cancellationFieldsChanged =
    Object.hasOwn(previous, "cancel_at") ||
    Object.hasOwn(previous, "cancel_at_period_end");

  if (scheduledFor && cancellationFieldsChanged && !previousWasScheduled) {
    return { kind: "scheduled", scheduledFor };
  }
  if (!scheduledFor && cancellationFieldsChanged && previousWasScheduled) {
    return { kind: "revoked" };
  }
  return { kind: "unchanged", scheduledFor };
}
