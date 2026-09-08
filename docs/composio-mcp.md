# Connect DoodleNote to Composio

DoodleNote's desktop **Settings > Integrations > Composio / remote MCP** provides
the server URL separately from the local MCP launch configuration. Web
**Settings > AI agents** shows the same setup for that server.

## Before connecting

- Sign in to the DoodleNote web app and select the workspace you intend to share.
- Official hosted access requires Cloud Sync entitlement. Only synced notes and
  transcripts are available. Unsynced local notes and recording audio are not.
- Create a dedicated agent token named Composio in Settings > AI agents. The token
  is displayed once. Give it only to the intended Composio connected account.
- Keep DoodleNote's agent token separate from your Composio project API key.
  DoodleNote does not collect or store the Composio project key.
- Local MCP may remain disabled. To revoke remote access, revoke the agent token
  in web settings. Pausing local MCP or cloud uploads does not revoke that token
  or remove data already synced.

## Dashboard setup, when available

Use these values in Composio's Add Custom MCP form:

| Field | Value |
| --- | --- |
| Display name | DoodleNote |
| MCP server URL | `https://www.doodlenote.ai/api/mcp` for the official service |
| Authentication | API key, sent as an Authorization bearer header |
| Header mapping | `Authorization: Bearer {{generic_api_key}}` |
| Connected-account API key | Your DoodleNote agent token, without adding a second `Bearer ` prefix |

For self-hosting, use the public HTTPS URL shown by your instance, not the official
service. Configure `BETTER_AUTH_URL` on the web server and `DOODLE_SYNC_URL` for
the desktop instance consistently. Do not expose a local stdio process or put
credentials in a URL. Localhost cannot be reached by Composio.

Composio's Custom MCP feature is experimental. Its documentation currently
describes API registration; some accounts expose a dashboard form. If the form
only offers OAuth or cannot configure the bearer header, use the API flow below.
DoodleNote's hosted MCP does not provide OAuth Dynamic Client Registration.
Do not choose OAuth or disable authentication to make discovery pass.

## API setup alternative

The following are request templates, not automatically executed by DoodleNote.
Use a trusted API client with secure credential storage. Do not paste credentials
into shell history, shared screenshots, documentation, or source files.

1. Register the toolkit with `POST https://backend.composio.dev/api/v3.1/custom/toolkits/upsert`.
   Authenticate to Composio with its project key in the `x-api-key` header and
   send this JSON body. The in-app API section generates the same body using
   your configured server's origin.

   ```json
   {
     "slug": "DOODLENOTE",
     "toolkit_config": {
       "name": "DoodleNote",
       "app_url": "https://www.doodlenote.ai/api/mcp",
       "auth_schemes": [
         {
           "mode": "API_KEY",
           "headers": {
             "Authorization": "Bearer {{generic_api_key}}"
           }
         }
       ]
     }
   }
   ```

2. Use the returned toolkit slug (normally `CUSTOM_DOODLENOTE`) to create an
   auth config with `POST https://backend.composio.dev/api/v3.1/auth_configs`:

   ```json
   {
     "toolkit": { "slug": "CUSTOM_DOODLENOTE" },
     "auth_config": {
       "type": "use_custom_auth",
       "authScheme": "API_KEY",
       "credentials": {},
       "is_enabled_for_tool_router": true
     }
   }
   ```

3. Complete Composio's connected-account flow for that auth config and the
   intended Composio user. Supply the DoodleNote token as `generic_api_key`.
   Follow the current [Custom MCP guide](https://docs.composio.dev/docs/extending-sessions/custom-mcp)
   and [connected-account reference](https://docs.composio.dev/reference/api-reference/connected-accounts).
   An auth config alone is not an authenticated connection.

4. Once the account is active, verify tool sync. If the initial sync fails, use
   `POST https://backend.composio.dev/api/v3.1/custom/toolkits/sync` with the
   returned IDs:

   ```json
   {
     "slug": "CUSTOM_DOODLENOTE",
     "connected_account_id": "YOUR_CONNECTED_ACCOUNT_ID"
   }
   ```

5. Include the toolkit in your Composio session. Confirm the intended connected
   account is selected. Without automatic account matching, select it explicitly
   in the session's `connected_accounts` configuration as shown in the guide.

Review an existing toolkit before reusing its slug. Composio makes its server URL
and auth schemes immutable after registration. If they conflict, choose a new
slug or explicitly plan a replacement; deleting a toolkit also revokes its
connections. DoodleNote does not replace or delete toolkits for you.

## Verify and troubleshoot

Use a test workspace containing synthetic notes before granting access to real
meeting content. Confirm discovery of `list_recent_meetings`, `search_meetings`,
`get_meeting`, `get_meeting_notes`, and `get_meeting_transcript`. Run a read and
compare it to the expected fixture. An accepted URL or copied snippet is not
proof of a working connection.

| Symptom | Next check |
| --- | --- |
| Invalid token / 401 | Check the connected account's DoodleNote token and bearer header. A revoked token needs replacement. |
| Subscription required / 402 | Check the token owner's Cloud Sync entitlement in DoodleNote billing. |
| Empty meeting results | Confirm the workspace and that the intended notes have synced. |
| Service unavailable / 503 | Retry later; check the DoodleNote web service before rotating credentials. |
| No active connection | Check the Composio user, auth config and connected-account selection. |
| Toolkit has no tools | Check sync status and the selected toolkit version in Composio. |
| GET returns 405 | This stateless endpoint accepts MCP JSON-RPC POST requests, not a browser GET or persistent SSE stream. |

Verify a second workspace's note cannot be read and that revoking the dedicated
token prevents subsequent requests. Store only redacted results in QA evidence.
No new server, migration, additional tool permissions, or production configuration
change is needed for this setup UI.

Vendor contract checked 2026-09-08 against the
[official documentation source](https://github.com/ComposioHQ/composio/blob/next/docs/content/docs/extending-sessions/custom-mcp.mdx).
Authenticated Composio interoperability remains a release QA gate until recorded
against the intended test account; documentation alone does not establish it.
