import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ConfigError,
  configPathFor,
  loadConfig,
  productionConfigPath,
} from "./config";

function withDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "dn-mcp-config-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("production: DOODLE_NOTE_MCP_CONFIG or the home opt-in file", () => {
  assert.equal(configPathFor({}), productionConfigPath());
  assert.equal(
    configPathFor({ DOODLE_NOTE_MCP_CONFIG: "/x/mcp.json" }),
    "/x/mcp.json",
  );
});

test("a sandbox identity never falls back to the production opt-in file", () => {
  assert.throws(
    () => configPathFor({ DOODLE_NOTE_MCP_IDENTITY: "qa" }),
    ConfigError,
  );
  assert.throws(
    () =>
      configPathFor({
        DOODLE_NOTE_MCP_IDENTITY: "qa",
        DOODLE_NOTE_MCP_CONFIG: "rel/mcp.json",
      }),
    ConfigError,
  );
  assert.throws(
    () =>
      configPathFor({
        DOODLE_NOTE_MCP_IDENTITY: "qa",
        DOODLE_NOTE_MCP_CONFIG: productionConfigPath(),
      }),
    /production app's opt-in file/,
  );
  // No file at the sandbox path: refused, and the production file is not read.
  withDir((dir) => {
    const env = {
      DOODLE_NOTE_MCP_IDENTITY: "qa",
      DOODLE_NOTE_MCP_CONFIG: join(dir, "mcp.json"),
    };
    assert.throws(
      () => loadConfig(undefined, env),
      /No config found at .*mcp\.json/,
    );
  });
});

test("a sandbox identity only accepts a file written for that identity", () => {
  withDir((dir) => {
    const file = join(dir, "mcp.json");
    const env = {
      DOODLE_NOTE_MCP_IDENTITY: "qa",
      DOODLE_NOTE_MCP_CONFIG: file,
    };
    writeFileSync(
      file,
      JSON.stringify({ enabled: true, meetingsDir: "/prod/meetings" }),
    );
    assert.throws(
      () => loadConfig(undefined, env),
      /not written by the DoodleNote qa build/,
    );
    writeFileSync(
      file,
      JSON.stringify({
        enabled: true,
        meetingsDir: "/prod/meetings",
        identity: "dev",
      }),
    );
    assert.throws(
      () => loadConfig(undefined, env),
      /not written by the DoodleNote qa build/,
    );
    writeFileSync(
      file,
      "\uFEFF" +
        JSON.stringify({
          enabled: true,
          meetingsDir: "/qa/meetings",
          identity: "qa",
        }),
    );
    assert.deepEqual(loadConfig(undefined, env), {
      enabled: true,
      meetingsDir: "/qa/meetings",
    });
    // Without the identity (production), the same file is an ordinary opt-in file.
    assert.deepEqual(loadConfig(file, {}), {
      enabled: true,
      meetingsDir: "/qa/meetings",
    });
  });
});
