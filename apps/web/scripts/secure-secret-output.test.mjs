import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveSecretEnvFile } from "./secure-secret-output.mjs";

describe("secure secret output", () => {
  it("writes a new env file with owner-only permissions", () => {
    const dir = mkdtempSync(join(tmpdir(), "doodlenote-secret-output-"));
    try {
      const path = join(dir, "stripe-secret.env");
      const reservation = reserveSecretEnvFile(path);
      reservation.write("STRIPE_WEBHOOK_SECRET", "whsec_fixture");

      assert.equal(readFileSync(path, "utf8"), "STRIPE_WEBHOOK_SECRET=whsec_fixture\n");
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.throws(() => reserveSecretEnvFile(path), { code: "EEXIST" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes an unused reservation", () => {
    const dir = mkdtempSync(join(tmpdir(), "doodlenote-secret-output-"));
    try {
      const path = join(dir, "stripe-secret.env");
      const reservation = reserveSecretEnvFile(path);
      reservation.abort();

      assert.throws(() => statSync(path), { code: "ENOENT" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
