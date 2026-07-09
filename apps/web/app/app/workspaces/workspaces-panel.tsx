"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { buttonPrimary, inputClass } from "../../ui";

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface Member {
  id: string;
  email: string;
  role: string;
}

interface Invitation {
  id: string;
  email: string;
  status: string;
}

interface AgentToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function WorkspacesPanel({
  userEmail,
  activeOrganizationId,
  organizations,
  members,
  invitations,
  agentTokens,
}: {
  userEmail: string;
  activeOrganizationId: string | null;
  organizations: Workspace[];
  members: Member[];
  invitations: Invitation[];
  agentTokens: AgentToken[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePending, setInvitePending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [tokenPending, setTokenPending] = useState(false);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  async function handleSetActive(organizationId: string) {
    setError(null);
    const result = await authClient.organization.setActive({ organizationId });
    if (result.error) {
      setError(result.error.message ?? "Could not switch workspace");
      return;
    }
    router.refresh();
  }

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || !activeOrganizationId) return;
    setError(null);
    setInvitePending(true);
    const result = await authClient.organization.inviteMember({
      email,
      role: "member",
      organizationId: activeOrganizationId,
    });
    setInvitePending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not create the invitation");
      return;
    }
    setInviteEmail("");
    router.refresh();
  }

  async function copyInviteLink(invitationId: string) {
    const url = `${window.location.origin}/invite/${invitationId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invitationId);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setError(url); // clipboard blocked — surface the link itself
    }
  }

  async function cancelInvite(invitationId: string) {
    setError(null);
    const result = await authClient.organization.cancelInvitation({
      invitationId,
    });
    if (result.error) {
      setError(result.error.message ?? "Could not cancel the invitation");
      return;
    }
    router.refresh();
  }

  async function createAgentToken(event: React.FormEvent) {
    event.preventDefault();
    if (!activeOrganizationId) return;
    setError(null);
    setTokenPending(true);
    try {
      const res = await fetch("/api/agent-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: activeOrganizationId,
          name: tokenName.trim() || "Agent",
        }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? "Could not create the agent token");
        return;
      }
      setMintedToken(data.token);
      setTokenName("");
      router.refresh();
    } finally {
      setTokenPending(false);
    }
  }

  async function revokeAgentToken(id: string) {
    setError(null);
    const res = await fetch(`/api/agent-tokens/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not revoke the token");
      return;
    }
    router.refresh();
  }

  async function copyMintedToken() {
    if (!mintedToken) return;
    try {
      await navigator.clipboard.writeText(mintedToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2500);
    } catch {
      // The token is visible in the panel — nothing else to do.
    }
  }

  return (
    <main className="flex flex-1 flex-col">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
        Workspaces
      </h1>
      <p className="mt-1.5 text-sm text-stone">
        Signed in as {userEmail}. The active workspace scopes your meetings
        and notes.
      </p>

      {error && (
        <p role="alert" className="mt-4 break-all text-sm text-red-700">
          {error}
        </p>
      )}

      {organizations.length === 0 ? (
        <p className="mt-10 text-center text-sm text-stone">
          No workspaces yet.
        </p>
      ) : (
        <ul className="mt-6 border-y border-sand">
          {organizations.map((org) => {
            const isActive = org.id === activeOrganizationId;
            return (
              <li
                key={org.id}
                className="flex items-center justify-between gap-4 border-b border-sand px-2 py-4 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {org.name}
                  </p>
                  <p className="truncate text-xs text-stone">{org.slug}</p>
                </div>
                {isActive ? (
                  <span className="rounded-full bg-sage-fill px-2.5 py-0.5 text-xs font-medium text-sage-deep">
                    Active
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSetActive(org.id)}
                    className="rounded-md border border-sand bg-card px-2.5 py-1 text-xs text-ink transition-colors hover:bg-sage-fill"
                  >
                    Set active
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold text-ink">
          Members
        </h2>
        <p className="mt-1 text-sm text-stone">
          Everyone in the active workspace sees its synced meetings.
        </p>

        <ul className="mt-4 border-y border-sand">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-4 border-b border-sand px-2 py-3 last:border-b-0"
            >
              <span className="truncate text-sm text-ink">{member.email}</span>
              <span className="shrink-0 text-xs text-stone">{member.role}</span>
            </li>
          ))}
          {invitations.map((invite) => (
            <li
              key={invite.id}
              className="flex items-center justify-between gap-4 border-b border-sand px-2 py-3 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">
                  {invite.email}
                </span>
                <span className="text-xs text-stone">invited — send them the link</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyInviteLink(invite.id)}
                  className="rounded-md border border-sand bg-card px-2.5 py-1 text-xs text-ink transition-colors hover:bg-sage-fill"
                >
                  {copiedId === invite.id ? "Copied ✓" : "Copy invite link"}
                </button>
                <button
                  type="button"
                  onClick={() => cancelInvite(invite.id)}
                  className="rounded-md px-2 py-1 text-xs text-stone hover:text-red-700"
                  title="Cancel invitation"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>

        <form onSubmit={handleInvite} className="mt-4 flex items-start gap-2">
          <input
            type="email"
            placeholder="teammate@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="submit"
            disabled={invitePending || !inviteEmail.trim() || !activeOrganizationId}
            className={buttonPrimary}
          >
            {invitePending ? "Inviting…" : "Invite"}
          </button>
        </form>
        <p className="mt-2 text-xs text-stone">
          Invitations don&rsquo;t send email yet — copy the link and send it
          yourself. It works once they sign in with the invited address.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold text-ink">
          AI agents
        </h2>
        <p className="mt-1 text-sm text-stone">
          Tokens let AI tools (Claude, Codex, and other MCP clients) read this
          workspace&rsquo;s synced meetings through DoodleNote&rsquo;s hosted
          MCP server. Read-only; revoke anytime.
        </p>

        {mintedToken && (
          <div className="mt-4 rounded-md border border-sand bg-sage-fill/40 p-3">
            <p className="text-xs font-medium text-ink">
              Copy this token now — it won&rsquo;t be shown again.
            </p>
            <p className="mt-1 break-all font-mono text-xs text-ink">
              {mintedToken}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={copyMintedToken}
                className="rounded-md border border-sand bg-card px-2.5 py-1 text-xs text-ink transition-colors hover:bg-sage-fill"
              >
                {tokenCopied ? "Copied ✓" : "Copy token"}
              </button>
              <button
                type="button"
                onClick={() => setMintedToken(null)}
                className="text-xs text-stone hover:text-ink"
              >
                Done
              </button>
            </div>
            <p className="mt-2 text-xs text-stone">
              Connect with:{" "}
              <code className="break-all">
                claude mcp add --transport http doodle-note
                https://www.doodlenote.ai/api/mcp --header
                &quot;Authorization: Bearer &lt;token&gt;&quot;
              </code>
            </p>
          </div>
        )}

        {agentTokens.length > 0 && (
          <ul className="mt-4 border-y border-sand">
            {agentTokens.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-4 border-b border-sand px-2 py-3 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">
                    {t.name}
                  </span>
                  <span className="text-xs text-stone">
                    created {new Date(t.createdAt).toLocaleDateString()}
                    {t.lastUsedAt
                      ? ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                      : " · never used"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => revokeAgentToken(t.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-stone hover:text-red-700"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={createAgentToken} className="mt-4 flex items-start gap-2">
          <input
            type="text"
            placeholder="Token name (e.g. Claude on laptop)"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="submit"
            disabled={tokenPending || !activeOrganizationId}
            className={buttonPrimary}
          >
            {tokenPending ? "Creating…" : "Create token"}
          </button>
        </form>
      </section>
    </main>
  );
}
