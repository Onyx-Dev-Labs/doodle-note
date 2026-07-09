import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Agent access is strictly opt-in: this server refuses to start unless the
 * user has explicitly enabled it, which the DoodleNote app does by writing
 * this config file (Settings → Agent access). Deleting the file or setting
 * enabled=false revokes access; nothing else is consulted.
 */
export interface McpConfig {
  enabled: boolean;
  /** Absolute path to DoodleNote's meetings directory. */
  meetingsDir: string;
}

export function defaultConfigPath(): string {
  return (
    process.env["DOODLE_NOTE_MCP_CONFIG"] ??
    join(homedir(), ".doodlenote", "mcp.json")
  );
}

export class ConfigError extends Error {}

export function loadConfig(path = defaultConfigPath()): McpConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(
      `Agent access is not enabled. No config found at ${path}.\n` +
        "Enable it in the DoodleNote app under Settings → Agent access, " +
        "which writes this file with the correct meetings path.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`Config at ${path} is not valid JSON.`);
  }
  const cfg = parsed as Partial<McpConfig>;
  if (cfg.enabled !== true) {
    throw new ConfigError(
      `Agent access is disabled in ${path}. ` +
        "Re-enable it in the DoodleNote app under Settings → Agent access.",
    );
  }
  if (typeof cfg.meetingsDir !== "string" || cfg.meetingsDir.length === 0) {
    throw new ConfigError(`Config at ${path} is missing "meetingsDir".`);
  }
  return { enabled: true, meetingsDir: cfg.meetingsDir };
}
