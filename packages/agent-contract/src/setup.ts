/** Browser-safe setup information. Never accepts or stores credentials. */
export const COMPOSIO_DOCS_URL =
  "https://docs.composio.dev/docs/extending-sessions/custom-mcp";
export const COMPOSIO_AUTH_HEADER = "Authorization: Bearer {{generic_api_key}}";

export function remoteMcpSetup(baseUrl: string | undefined) {
  if (!baseUrl) return null;
  let origin: URL;
  try {
    origin = new URL(baseUrl);
  } catch {
    return null;
  }
  if (origin.protocol !== "https:" || origin.username || origin.password)
    return null;
  const serverUrl = new URL("/api/mcp", origin.origin).href;
  return {
    serverUrl,
    agentsUrl: new URL("/app/settings/agents", origin.origin).href,
    registrationJson: JSON.stringify(
      {
        slug: "DOODLENOTE",
        toolkit_config: {
          name: "DoodleNote",
          app_url: serverUrl,
          auth_schemes: [
            {
              mode: "API_KEY",
              headers: { Authorization: "Bearer {{generic_api_key}}" },
            },
          ],
        },
      },
      null,
      2,
    ),
  };
}

/** Use a callback so unavailable clipboard APIs also fail inside the guard. */
export async function copyMcpServerUrl(
  serverUrl: string,
  writeText: (text: string) => Promise<void>,
): Promise<{ ok: boolean; message: string }> {
  try {
    await writeText(serverUrl);
    return {
      ok: true,
      message: "Server URL copied. Finish setup in Composio.",
    };
  } catch {
    return {
      ok: false,
      message: "Could not copy. Select and copy the server URL above.",
    };
  }
}
