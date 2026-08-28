import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { billingViewFromStatus } from "../app/pricing/billing-view";

describe("pricing billing status", () => {
  it("does not mislabel a failed status request as signed out", () => {
    assert.deepEqual(billingViewFromStatus(false, { error: "database unavailable" }), {
      kind: "error",
    });
    assert.deepEqual(billingViewFromStatus(true, null), { kind: "error" });
  });

  it("keeps signed-out, disabled, trial, and subscription states explicit", () => {
    assert.deepEqual(
      billingViewFromStatus(true, {
        entitled: false,
        reason: "signed-out",
        billingEnabled: true,
      }),
      { kind: "signed-out" },
    );
    assert.deepEqual(
      billingViewFromStatus(true, {
        entitled: false,
        reason: "configuration_error",
        billingEnabled: false,
      }),
      { kind: "disabled" },
    );
    assert.deepEqual(
      billingViewFromStatus(true, {
        entitled: false,
        reason: "none",
        billingEnabled: true,
      }),
      { kind: "start-trial" },
    );
    assert.deepEqual(
      billingViewFromStatus(true, {
        entitled: true,
        reason: "trialing",
        billingEnabled: true,
      }),
      { kind: "subscribed", reason: "trialing" },
    );
  });

  it("represents legacy access without a forever-free claim", () => {
    assert.deepEqual(
      billingViewFromStatus(true, {
        entitled: true,
        reason: "grandfathered",
        billingEnabled: true,
      }),
      { kind: "legacy-access" },
    );

    const button = readFileSync(
      new URL("../app/pricing/checkout-button.tsx", import.meta.url),
      "utf8",
    );
    const page = readFileSync(
      new URL("../app/pricing/page.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(button, /early supporter|Sync is free on your account/i);
    assert.doesNotMatch(page, /Early access/);
    assert.match(page, /\/ user \/ month/);
  });
});
