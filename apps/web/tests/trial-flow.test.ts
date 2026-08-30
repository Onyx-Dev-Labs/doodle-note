import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TRIAL_CHECKOUT_PATH,
  TRIAL_LOGIN_PATH,
  shouldAutoStartTrialCheckout,
} from "../app/pricing/trial-flow";

describe("trial checkout handoff", () => {
  it("preserves the checkout intent through authentication", () => {
    assert.equal(TRIAL_CHECKOUT_PATH, "/pricing?checkout=1");
    assert.equal(
      TRIAL_LOGIN_PATH,
      "/login?next=%2Fpricing%3Fcheckout%3D1",
    );
  });

  it("starts checkout once only after an eligible billing status is loaded", () => {
    assert.equal(
      shouldAutoStartTrialCheckout({
        requested: true,
        attempted: false,
        viewKind: "start-trial",
      }),
      true,
    );
    assert.equal(
      shouldAutoStartTrialCheckout({
        requested: true,
        attempted: true,
        viewKind: "start-trial",
      }),
      false,
    );
    assert.equal(
      shouldAutoStartTrialCheckout({
        requested: true,
        attempted: false,
        viewKind: "signed-out",
      }),
      false,
    );
    assert.equal(
      shouldAutoStartTrialCheckout({
        requested: false,
        attempted: false,
        viewKind: "start-trial",
      }),
      false,
    );
  });
});
