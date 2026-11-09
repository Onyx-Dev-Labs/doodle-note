import assert from "node:assert/strict";
import { test } from "node:test";

import { safeNextPath } from "../lib/safe-next-path";

test("safeNextPath keeps same-site paths and rejects anything that can leave the site", () => {
  assert.equal(safeNextPath("/app/settings?x=1"), "/app/settings?x=1");
  assert.equal(safeNextPath(undefined), "/app");
  assert.equal(safeNextPath(""), "/app");
  for (const bad of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "/app\\..\\evil",
    "/\tevil.example",
    "/%0d%0a" + "\r\nSet-Cookie: a=b",
    "evil.example",
  ]) {
    assert.equal(safeNextPath(bad), "/app", bad);
  }
});
