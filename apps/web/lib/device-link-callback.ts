/** Native requests bind the callback to one browser attempt. Desktop port callbacks remain compatible. */
export function validLinkState(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? value
    : null;
}

export function linkCredentialScope(options: {
  platform: string;
  purpose?: unknown;
  state?: unknown;
  entitled: boolean;
}): "sync" | "identity" | "subscription" | "invalid" {
  if (options.platform === "ios") {
    if (options.purpose !== "native-library" || !validLinkState(options.state)) return "invalid";
    return options.entitled ? "sync" : "identity";
  }
  return options.entitled ? "sync" : "subscription";
}

export function deviceLinkCallback(options: {
  port: number | null;
  scheme?: string | null;
  state?: string | null;
  token: string;
  email: string;
  workspaceName: string;
}): string {
  const params = new URLSearchParams({
    token: options.token,
    email: options.email,
    workspace: options.workspaceName,
  });
  if (options.scheme === "doodlenote") {
    const state = validLinkState(options.state);
    if (!state) throw new Error("invalid_callback");
    params.set("state", state);
    return `doodlenote://link?${params}`;
  }
  if (options.scheme || !Number.isInteger(options.port) ||
      options.port! < 1024 || options.port! > 65535) {
    throw new Error("invalid_callback");
  }
  return `http://127.0.0.1:${options.port}/callback?${params}`;
}
