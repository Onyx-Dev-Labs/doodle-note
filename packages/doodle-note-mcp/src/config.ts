import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Agent access is strictly opt-in: this server refuses to start unless the
 * user has explicitly enabled it, which the DoodleNote app does by writing
 * this config file (Settings → Agent access). Deleting the file or setting
 * enabled=false revokes access; nothing else is consulted.
 *
 * A development or QA build of the app keeps its opt-in file in a sandbox and
 * launches this server with DOODLE_NOTE_MCP_IDENTITY plus the absolute
 * DOODLE_NOTE_MCP_CONFIG of that file. With an identity set, the server only
 * accepts that exact file, written for that identity: it never falls back to
 * ~/.doodlenote/mcp.json, which belongs to the production app and would
 * expose its library.
 */
export interface McpConfig {
  enabled: boolean;
  /** Absolute path to DoodleNote's meetings directory. */
  meetingsDir: string;
}

type Env = Record<string, string | undefined>;

export function productionConfigPath(): string {
  return join(homedir(), ".doodlenote", "mcp.json");
}

export function defaultConfigPath(env: Env = process.env): string {
  return env["DOODLE_NOTE_MCP_CONFIG"] ?? productionConfigPath();
}

export class ConfigError extends Error {}

/** The sandbox identity this server was launched for, or null (production). */
function sandboxIdentity(env: Env): string | null {
  const identity = env["DOODLE_NOTE_MCP_IDENTITY"];
  return identity === undefined || identity === "" ? null : identity;
}

/**
 * Where to read the opt-in file. With a sandbox identity, only an explicit,
 * absolute DOODLE_NOTE_MCP_CONFIG that is not the production file is allowed.
 */
export function configPathFor(env: Env = process.env): string {
  const identity = sandboxIdentity(env);
  if (identity === null) return defaultConfigPath(env);
  const path = env["DOODLE_NOTE_MCP_CONFIG"];
  if (path === undefined || path === "" || !isAbsolute(path)) {
    throw new ConfigError(
      `This server was launched for the DoodleNote ${identity} build but without the absolute ` +
        "DOODLE_NOTE_MCP_CONFIG of its opt-in file. Reconnect the client from that build's " +
        "Settings → Agent access.",
    );
  }
  if (
    resolve(path).toLowerCase() ===
    resolve(productionConfigPath()).toLowerCase()
  ) {
    throw new ConfigError(
      `This server was launched for the DoodleNote ${identity} build, but ${path} is the ` +
        "production app's opt-in file. Reconnect the client from that build's Settings → Agent access.",
    );
  }
  return path;
}

export function loadConfig(path?: string, env: Env = process.env): McpConfig {
  const identity = sandboxIdentity(env);
  const file = path ?? configPathFor(env);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new ConfigError(
      `Agent access is not enabled. No config found at ${file}.\n` +
        "Enable it in the DoodleNote app under Settings → Agent access, " +
        "which writes this file with the correct meetings path.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new ConfigError(`Config at ${file} is not valid JSON.`);
  }
  const cfg = (parsed ?? {}) as Partial<McpConfig> & { identity?: unknown };
  if (identity !== null && cfg.identity !== identity) {
    throw new ConfigError(
      `Config at ${file} was not written by the DoodleNote ${identity} build. ` +
        "Re-enable agent access in that build's Settings → Agent access.",
    );
  }
  if (cfg.enabled !== true) {
    throw new ConfigError(
      `Agent access is disabled in ${file}. ` +
        "Re-enable it in the DoodleNote app under Settings → Agent access.",
    );
  }
  if (typeof cfg.meetingsDir !== "string" || cfg.meetingsDir.length === 0) {
    throw new ConfigError(`Config at ${file} is missing "meetingsDir".`);
  }
  return { enabled: true, meetingsDir: cfg.meetingsDir };
}
