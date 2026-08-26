import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const uiSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app/ui.tsx"),
  "utf8",
);

test("marketing brand lockup includes Onyx builder attribution", () => {
  assert.match(uiSource, /built by\{" "\}/);
  assert.match(uiSource, /Onyx Dev Labs/);
  assert.match(uiSource, /ONYX_URL = "https:\/\/onyxdev\.io"/);
  assert.match(uiSource, /export function BrandLockup/);
  assert.match(uiSource, /<BrandLockup priority \/>/);
  assert.match(uiSource, /<BrandLockup compact \/>/);
});
