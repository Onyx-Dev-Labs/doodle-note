import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cancellationChange,
  subscriptionCancellationDate,
} from "../lib/billing-cancellation-state";
import {
  buildCancellationScheduledEmail,
  buildCloudSyncEndedEmail,
} from "../lib/billing-email-content";

describe("billing cancellation lifecycle", () => {
  it("uses Stripe's explicit cancellation time when present", () => {
    const value = subscriptionCancellationDate({
      cancelAt: 1_789_430_400,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: 1_800_000_000,
    });

    assert.equal(value?.toISOString(), "2026-09-15T00:00:00.000Z");
  });

  it("uses the period end for cancellation at period end", () => {
    const value = subscriptionCancellationDate({
      cancelAt: null,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: 1_789_430_400,
    });

    assert.equal(value?.toISOString(), "2026-09-15T00:00:00.000Z");
  });

  it("detects scheduling and resumption transitions", () => {
    assert.deepEqual(
      cancellationChange(
        { cancelAt: null, cancelAtPeriodEnd: true, currentPeriodEnd: 1_789_430_400 },
        { cancel_at_period_end: false },
      ),
      {
        kind: "scheduled",
        scheduledFor: new Date("2026-09-15T00:00:00.000Z"),
      },
    );

    assert.deepEqual(
      cancellationChange(
        { cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: 1_789_430_400 },
        { cancel_at_period_end: true },
      ),
      { kind: "revoked" },
    );
  });
});

describe("billing cancellation email content", () => {
  const input = {
    email: "billing-user@example.com",
    effectiveAt: new Date("2026-09-15T00:00:00.000Z"),
    manageUrl: "https://www.doodlenote.ai/app/settings/billing",
    mascotUrl: "https://www.doodlenote.ai/mascot.png",
  };

  it("states the deletion date and distinguishes local and shared data", () => {
    const message = buildCancellationScheduledEmail(input);

    assert.equal(
      message.subject,
      "Your DoodleNote Cloud Sync cancellation is scheduled",
    );
    assert.match(message.text, /September 15, 2026/);
    assert.match(message.text, /permanently delete the active cloud copy/i);
    assert.match(message.text, /Personal workspace/i);
    assert.match(message.text, /local notes and recordings.*not deleted/i);
    assert.match(message.text, /shared workspaces.*retained/i);
    assert.match(message.html, /Manage subscription/);
  });

  it("confirms deletion only after Cloud Sync has ended", () => {
    const message = buildCloudSyncEndedEmail(input);

    assert.equal(message.subject, "Your DoodleNote Cloud Sync has ended");
    assert.match(message.text, /active cloud copy.*permanently deleted/i);
    assert.match(message.text, /local notes and recordings.*remain/i);
    assert.match(message.html, /Restart Cloud Sync/);
  });
});
