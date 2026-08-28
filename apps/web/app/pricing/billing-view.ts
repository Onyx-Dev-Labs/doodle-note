export type BillingView =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "disabled" }
  | { kind: "error" }
  | { kind: "start-trial" }
  | { kind: "legacy-access" }
  | { kind: "subscribed"; reason: string };

interface BillingStatus {
  entitled?: unknown;
  reason?: unknown;
  billingEnabled?: unknown;
}

export function billingViewFromStatus(
  responseOk: boolean,
  value: unknown,
): BillingView {
  if (!responseOk || !value || typeof value !== "object") {
    return { kind: "error" };
  }

  const body = value as BillingStatus;
  if (body.billingEnabled === false) return { kind: "disabled" };
  if (body.billingEnabled !== true || typeof body.reason !== "string") {
    return { kind: "error" };
  }
  if (body.reason === "signed-out") return { kind: "signed-out" };
  if (body.reason === "grandfathered" && body.entitled === true) {
    return { kind: "legacy-access" };
  }
  if (body.entitled === true) {
    return { kind: "subscribed", reason: body.reason };
  }
  if (body.entitled === false) return { kind: "start-trial" };
  return { kind: "error" };
}
