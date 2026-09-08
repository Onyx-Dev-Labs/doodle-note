"use client";

import { useState } from "react";
import {
  COMPOSIO_AUTH_HEADER,
  COMPOSIO_DOCS_URL,
  copyMcpServerUrl,
  remoteMcpSetup,
} from "@repo/agent-contract/setup";

export function RemoteMcpSetup({ baseUrl }: { baseUrl: string }) {
  const setup = remoteMcpSetup(baseUrl);
  const [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function copy() {
    if (!setup) return;
    setCopying(true);
    setFeedback("");
    const result = await copyMcpServerUrl(setup.serverUrl, (text) =>
      navigator.clipboard.writeText(text),
    );
    setFeedback(result.message);
    setCopying(false);
  }

  return (
    <section
      aria-labelledby="remote-mcp-heading"
      className="mt-6 rounded-xl border border-sand bg-card p-4 text-sm leading-relaxed text-ink"
    >
      <h3 id="remote-mcp-heading" className="font-medium">
        Composio / remote MCP
      </h3>
      <p className="mt-2 text-stone">
        Remote agents read this workspace’s synced notes and transcripts. Cloud
        Sync access is required on doodlenote.ai. Unsynced local notes and
        recording audio stay on your device.
      </p>
      {setup ? (
        <>
          <label htmlFor="remote-mcp-url" className="mt-4 block font-medium">
            MCP server URL
          </label>
          <input
            id="remote-mcp-url"
            value={setup.serverUrl}
            readOnly
            className="mt-1 w-full min-w-0 rounded-lg border border-sand bg-card p-2 font-mono text-xs text-ink"
          />
          <button
            type="button"
            onClick={() => void copy()}
            disabled={copying}
            className="mt-2 rounded-lg border border-sand px-3 py-2 hover:bg-sage-fill disabled:opacity-50"
          >
            {copying ? "Copying…" : "Copy server URL"}
          </button>
          <p role="status" className="mt-2 text-stone">
            {feedback}
          </p>
          <ol className="mt-4 list-decimal space-y-2 pl-5">
            <li>
              Confirm the workspace above. Create a dedicated token named
              Composio below and copy it once.
            </li>
            <li>
              In Composio, use display name <strong>DoodleNote</strong> and this
              URL. Choose API-key authentication, not OAuth or no
              authentication.
            </li>
            <li>
              Use the DoodleNote token as the connected account’s API key, with
              header{" "}
              <code className="break-all text-xs">{COMPOSIO_AUTH_HEADER}</code>.
              Your Composio project key is a separate credential.
            </li>
            <li>
              Sync the toolkit’s tools and test a read in Composio. Copying the
              URL does not connect an account.
            </li>
          </ol>
          <details className="mt-4">
            <summary className="cursor-pointer font-medium">
              API setup and troubleshooting
            </summary>
            <p className="mt-2">
              If your dashboard only offers OAuth or cannot map the bearer
              header, use Composio’s Custom MCP API. Register with this body,
              then create an API-key auth config and connected account using the
              guide.
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-sage-fill/50 p-3 text-xs">
              {setup.registrationJson}
            </pre>
            <a
              href={COMPOSIO_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block underline"
            >
              Composio setup guide
            </a>
            <p className="mt-2 text-stone">
              Subscription required? Check Cloud Sync access in billing. No
              results? Check this workspace and sync the notes you want to
              share. Invalid token? Create a replacement here. Service
              unavailable? Retry later before changing credentials.
            </p>
          </details>
        </>
      ) : (
        <p role="status" className="mt-3 text-stone">
          Composio requires a public HTTPS server. This instance has no HTTPS
          address configured. Configure its public server address before
          connecting; localhost is not reachable by Composio.
        </p>
      )}
      <p className="mt-4 text-stone">
        Local MCP can stay off. Revoke the dedicated token here to stop remote
        access. Pausing local access or Sync does not revoke a remote token.
      </p>
    </section>
  );
}
