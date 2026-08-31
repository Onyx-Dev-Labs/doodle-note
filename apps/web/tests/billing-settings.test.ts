import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, test } from "node:test";

import { billingSettingsState } from "../app/app/settings/billing/billing-settings-state";

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4),
    );
  assert.ok(channels && channels.length === 3, `invalid hex color: ${hex}`);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrastRatio(left: string, right: string): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("billing settings state", () => {
  it("shows active subscribers a Stripe management action", () => {
    assert.deepEqual(
      billingSettingsState(true, {
        status: "active",
        grandfathered: false,
        stripeCustomerId: "cus_active",
      }),
      {
        kind: "active",
        title: "Cloud Sync active",
        description: "Your Cloud Sync subscription is active.",
        canManage: true,
        canStart: false,
      },
    );
  });

  it("sends past-due subscribers to Stripe to change their card", () => {
    const state = billingSettingsState(true, {
      status: "past_due",
      grandfathered: false,
      stripeCustomerId: "cus_past_due",
    });
    assert.equal(state.kind, "attention");
    assert.equal(state.title, "Payment needs attention");
    assert.equal(state.canManage, true);
    assert.equal(state.canStart, false);
  });

  it("offers Checkout only when there is no active subscription", () => {
    assert.deepEqual(billingSettingsState(true), {
      kind: "inactive",
      title: "No active subscription",
      description: "Start a 15-day Cloud Sync trial when you are ready.",
      canManage: false,
      canStart: true,
    });
  });

  it("keeps legacy access outside Stripe billing", () => {
    const state = billingSettingsState(true, {
      status: "none",
      grandfathered: true,
      stripeCustomerId: null,
    });
    assert.equal(state.kind, "legacy");
    assert.equal(state.canManage, false);
    assert.equal(state.canStart, false);
  });
});

test("verification and subscription management surfaces stay discoverable and theme-safe", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const login = readFileSync(join(root, "app/login/login-form.tsx"), "utf8");
  const settingsNav = readFileSync(
    join(root, "app/app/settings/settings-nav.tsx"),
    "utf8",
  );
  const portal = readFileSync(
    join(root, "app/api/billing/portal/route.ts"),
    "utf8",
  );

  assert.match(
    login,
    /rounded-xl border border-sand bg-card p-5 text-center text-bark/,
  );
  assert.doesNotMatch(login, /border border-sand bg-white p-5 text-center/);
  assert.match(settingsNav, /\/app\/settings\/billing/);
  assert.match(portal, /configuration: portalConfigurationId/);
  assert.match(portal, /return_url: `\$\{origin\}\/app\/settings\/billing`/);
});

test("dark verification card colors meet normal-text contrast", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const styles = readFileSync(join(root, "app/globals.css"), "utf8");
  const darkCard = "#262922";

  assert.match(styles, /--color-card: #262922/);
  assert.match(styles, /--color-ink: #f0eee2/);
  assert.match(styles, /--color-bark: #cfcdbe/);
  assert.match(styles, /--color-stone: #aeb19d/);
  assert.match(styles, /--color-sage-deep: #aac996/);
  assert.ok(contrastRatio(darkCard, "#f0eee2") >= 4.5, "ink contrast");
  assert.ok(contrastRatio(darkCard, "#cfcdbe") >= 4.5, "body contrast");
  assert.ok(contrastRatio(darkCard, "#aeb19d") >= 4.5, "muted contrast");
  assert.ok(contrastRatio(darkCard, "#aac996") >= 4.5, "status contrast");
});
