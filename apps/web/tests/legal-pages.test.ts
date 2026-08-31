import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../app");

function source(path: string): string {
  return readFileSync(join(appRoot, path), "utf8");
}

test("public footer links to privacy and terms without overstating local-only behavior", () => {
  const ui = source("ui.tsx");
  assert.match(ui, /href="\/contact"/);
  assert.match(ui, /href="\/privacy"/);
  assert.match(ui, /href="\/terms"/);
  assert.match(ui, /lg:flex-nowrap/);
  assert.match(ui, /Local-first\. Cloud only when you opt in\.<\/span>/);
  assert.match(ui, /Cloud only when you opt in/);
  assert.doesNotMatch(ui, /Your meetings never leave your device/);
});

test("privacy policy documents local, synced, shared, and deletion behavior", () => {
  const privacy = source("privacy/page.tsx");
  assert.match(privacy, /does\s+not\s+upload meeting audio as part of Sync/);
  assert.match(privacy, /meeting titles, notes, transcripts/);
  assert.match(privacy, /Contact-form details/);
  assert.match(privacy, /contact-form email/);
  assert.match(privacy, /public\s+share\s+link/);
  assert.match(privacy, /request\s+account or other hosted-data/);
  assert.match(privacy, /permanently deletes the active cloud copy/);
  assert.match(privacy, /provider&apos;s normal backup rotation/);
  assert.match(privacy, /Local notes and recordings remain/);
  assert.match(privacy, /shared workspaces is retained/);
  assert.match(privacy, /team@onyxdev\.io/);
});

test("terms separate the MIT software license from the hosted service", () => {
  const terms = source("terms/page.tsx");
  assert.match(terms, /MIT\s+License governs/);
  assert.match(terms, /service terms separately govern/);
  assert.match(terms, /recording-consent requirements/);
  assert.match(terms, /permanently deletes the\s+active cloud copy/);
  assert.match(terms, /stored\s+locally on your devices are not deleted/);
});
