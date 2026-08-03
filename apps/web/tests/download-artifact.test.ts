import assert from "node:assert/strict";
import { test } from "node:test";

import { downloadArtifactFromManifest } from "../lib/download-artifact";

const macManifest = `version: 0.4.10
files:
  - url: DoodleNote-0.4.10-arm64-mac.zip
path: DoodleNote-0.4.10-arm64-mac.zip
`;

test("website Mac downloads use the version-matched DMG", () => {
  assert.equal(
    downloadArtifactFromManifest("mac", macManifest),
    "DoodleNote-0.4.10-arm64.dmg",
  );
});

test("Windows downloads continue using the updater manifest path", () => {
  assert.equal(
    downloadArtifactFromManifest(
      "win",
      "version: 0.4.10\npath: DoodleNote-0.4.10-setup.exe\n",
    ),
    "DoodleNote-0.4.10-setup.exe",
  );
});

test("malformed or unsafe versions never become redirect targets", () => {
  assert.equal(downloadArtifactFromManifest("mac", "version: ../../evil\n"), null);
  assert.equal(downloadArtifactFromManifest("linux", macManifest), null);
});
