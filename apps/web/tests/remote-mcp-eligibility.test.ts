import assert from "node:assert/strict";
import test from "node:test";
import { entitlementFrom, isRemoteMcpEligible } from "../lib/billing-state";

test("remote setup permits active paid and trialing subscriptions, independently of broad Sync entitlement", () => {
  for (const grandfathered of [false, true]) {
    for (const status of ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "none", "grandfathered", "invalid_price"]) {
      const entitlement = entitlementFrom("stripe", { status, grandfathered, currentPeriodEnd: new Date("2030-01-01") });
      assert.equal(isRemoteMcpEligible(entitlement), ["active", "trialing"].includes(status), `${status}, grandfathered=${grandfathered}`);
    }
  }
  for (const mode of ["stripe", "self-hosted", "development", "misconfigured"] as const) {
    assert.equal(isRemoteMcpEligible(entitlementFrom(mode)), false, mode);
  }
});

test("scheduled cancellation retains eligibility only while the paid subscription is active", () => {
  // The existing webhook contract retains active until the paid period ends.
  const state = { status: "active", grandfathered: false, currentPeriodEnd: new Date("2030-01-01") };
  assert.equal(isRemoteMcpEligible(entitlementFrom("stripe", state)), true);
  assert.equal(isRemoteMcpEligible(entitlementFrom("stripe", { ...state, status: "canceled" })), false);
});

test("trial activation, paid conversion and expiration refresh remote setup eligibility", () => {
  for (const status of ["none", "trialing", "active", "canceled"]) {
    const entitlement = entitlementFrom("stripe", { status, grandfathered: false, currentPeriodEnd: new Date("2030-01-01") });
    assert.equal(isRemoteMcpEligible(entitlement), status === "trialing" || status === "active", status);
  }
});
