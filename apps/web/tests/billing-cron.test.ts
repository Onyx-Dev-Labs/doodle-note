import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { GET } from "../app/api/cron/billing-lifecycle/route";

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("billing lifecycle worker authentication", () => {
  it("fails closed when the deployment secret is missing", async () => {
    const response = await GET(
      new Request("https://www.doodlenote.ai/api/cron/billing-lifecycle"),
    );

    assert.equal(response.status, 503);
  });

  it("rejects callers without the exact bearer secret", async () => {
    process.env.CRON_SECRET = "fixture-cron-secret";
    const response = await GET(
      new Request("https://www.doodlenote.ai/api/cron/billing-lifecycle", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );

    assert.equal(response.status, 401);
  });
});
