import assert from "node:assert/strict";
import test from "node:test";
import { entitlementFrom, hasActivePaidSubscription } from "../lib/billing-state";

test("remote setup requires active paid status, independently of broad Sync entitlement", () => {
  for (const grandfathered of [false, true]) {
    for (const status of ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "none", "grandfathered", "invalid_price"]) {
      const entitlement = entitlementFrom("stripe", { status, grandfathered, currentPeriodEnd: new Date("2030-01-01") });
      assert.equal(hasActivePaidSubscription(entitlement), status === "active", `${status}, grandfathered=${grandfathered}`);
    }
  }
  for (const mode of ["stripe", "self-hosted", "development", "misconfigured"] as const) {
    assert.equal(hasActivePaidSubscription(entitlementFrom(mode)), false, mode);
  }
});

test("scheduled cancellation retains eligibility only while the paid subscription is active", () => {
  // The existing webhook contract retains active until the paid period ends.
  const state = { status: "active", grandfathered: false, currentPeriodEnd: new Date("2030-01-01") };
  assert.equal(hasActivePaidSubscription(entitlementFrom("stripe", state)), true);
  assert.equal(hasActivePaidSubscription(entitlementFrom("stripe", { ...state, status: "canceled" })), false);
});
