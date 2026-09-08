import { useState } from 'react'
import {
  COMPOSIO_AUTH_HEADER,
  COMPOSIO_DOCS_URL,
  copyMcpServerUrl,
  remoteMcpSetup
} from '@repo/agent-contract/setup'

export function RemoteMcpSetup({ baseUrl }: { baseUrl: string | undefined }): React.JSX.Element {
  const setup = remoteMcpSetup(baseUrl)
  const [copying, setCopying] = useState(false)
  const [feedback, setFeedback] = useState('')

  async function copy(): Promise<void> {
    if (!setup) return
    setCopying(true)
    setFeedback('')
    const result = await copyMcpServerUrl(setup.serverUrl, (text) =>
      navigator.clipboard.writeText(text)
    )
    setFeedback(result.message)
    setCopying(false)
  }

  return (
    <section
      className="keys-section calendar-section remote-mcp"
      aria-labelledby="remote-mcp-title"
    >
      <h3 id="remote-mcp-title">Composio / remote MCP</h3>
      <p className="models-sub">
        Let Composio read a cloud workspace’s synced notes and transcripts. Requires Cloud Sync
        access. Unsynced local notes and recording audio are not available remotely.
      </p>
      {setup ? (
        <>
          <label className="cal-row-label" htmlFor="remote-mcp-url">
            MCP server URL
          </label>
          <input id="remote-mcp-url" className="remote-mcp-url" readOnly value={setup.serverUrl} />
          <div className="calendar-actions">
            <button type="button" disabled={copying} onClick={() => void copy()}>
              {copying ? 'Copying…' : 'Copy server URL'}
            </button>
            <button type="button" onClick={() => window.open(setup.agentsUrl)}>
              Open token settings
            </button>
          </div>
          <p className="calendar-note" role="status">
            {feedback}
          </p>
          <ol className="remote-mcp-steps">
            <li>
              Open token settings, sign in, and select the workspace you want Composio to read.
              Create a dedicated token named Composio and copy it once.
            </li>
            <li>
              In Composio, use display name <strong>DoodleNote</strong> and the server URL above.
              Choose API-key authentication, not OAuth or no authentication.
            </li>
            <li>
              Store the DoodleNote token as the connected account’s API key. The server needs{' '}
              <code>{COMPOSIO_AUTH_HEADER}</code>. Keep your Composio project key separate.
            </li>
            <li>
              Sync the toolkit’s tools in Composio and test a read from the intended workspace.
              Copying this URL does not connect an account.
            </li>
          </ol>
          <details>
            <summary>API setup and troubleshooting</summary>
            <p className="models-sub">
              If your Composio form only offers OAuth or cannot set the bearer header, use its
              Custom MCP API setup. Register with this body, then create an API-key auth config and
              connected account using the guide.
            </p>
            <pre>{setup.registrationJson}</pre>
            <div className="calendar-actions">
              <button type="button" onClick={() => window.open(COMPOSIO_DOCS_URL)}>
                Open Composio setup guide
              </button>
            </div>
            <p className="models-sub">
              Subscription required? Check Cloud Sync access in web billing. No meetings returned?
              Check the selected workspace and sync the notes you want to share. Invalid token?
              Create a replacement in that workspace. Service unavailable? Retry later and check
              DoodleNote’s web app before changing credentials.
            </p>
          </details>
        </>
      ) : (
        <p className="models-sub" role="status">
          Remote setup needs a public HTTPS DoodleNote server. If server settings have not loaded,
          reopen Settings. For a local or self-hosted server, configure its public HTTPS address
          first.
        </p>
      )}
      <p className="calendar-note">
        Local MCP can stay off. To stop remote access, revoke the dedicated token in web Settings
        &gt; AI agents. Pausing local access or Sync does not revoke a remote token.
      </p>
    </section>
  )
}
