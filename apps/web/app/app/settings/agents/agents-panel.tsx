"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { buttonPrimary, inputClass } from "../../../ui";

interface AgentToken { id: string; name: string; createdAt: string; lastUsedAt: string | null }

export function AgentsPanel({ organizationId, tokens }: { organizationId: string; tokens: AgentToken[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setError(null); setMessage(null); setPending(true);
    const response = await fetch("/api/agent-tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, name: name.trim() || "Agent" }) });
    const body = (await response.json()) as { token?: string; error?: string };
    setPending(false);
    if (!response.ok || !body.token) { setError(body.error ?? "Could not create the token"); return; }
    setMintedToken(body.token); setName(""); router.refresh();
  }

  async function revoke(id: string) {
    setError(null); const response = await fetch(`/api/agent-tokens/${id}`, { method: "DELETE" });
    if (!response.ok) { setError("Could not revoke the token"); return; }
    router.refresh();
  }

  async function copyToken() {
    if (!mintedToken) return;
    try { await navigator.clipboard.writeText(mintedToken); setMessage("Token copied."); }
    catch { setError("Clipboard access was blocked. The token remains visible below."); }
  }

  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-ink">Agent access</h2>
      <p className="mt-1 text-sm leading-relaxed text-stone">Read-only tokens let approved AI tools access the active workspace’s synced meetings through DoodleNote’s hosted MCP server. Revoke them anytime.</p>
      {(message || error) && <p aria-live="polite" className={`mt-4 text-sm ${error ? "text-red-700 dark:text-red-300" : "text-sage-deep"}`}>{error ?? message}</p>}
      {mintedToken && <div className="mt-5 rounded-xl border border-sand bg-sage-fill/50 p-4"><p className="text-sm font-medium text-ink">Copy this token now. It will not be shown again.</p><p className="mt-2 break-all font-mono text-xs text-ink">{mintedToken}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => void copyToken()} className="rounded-lg border border-sand bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill">Copy token</button><button type="button" onClick={() => setMintedToken(null)} className="px-3 py-2 text-sm text-stone hover:text-ink">Done</button></div></div>}
      {tokens.length > 0 && <ul className="mt-5 overflow-hidden rounded-xl border border-sand bg-card">{tokens.map((token) => <li key={token.id} className="flex items-center justify-between gap-3 border-b border-sand p-4 last:border-b-0"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{token.name}</p><p className="mt-0.5 text-xs text-stone">Created {new Date(token.createdAt).toLocaleDateString()}{token.lastUsedAt ? ` · Last used ${new Date(token.lastUsedAt).toLocaleDateString()}` : " · Never used"}</p></div><button type="button" onClick={() => void revoke(token.id)} className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950">Revoke</button></li>)}</ul>}
      <form onSubmit={create} className="mt-8 rounded-xl border border-sand bg-card p-4"><label className="block text-xs font-medium text-bark" htmlFor="agent-name">Token name</label><div className="mt-1 flex flex-col gap-2 sm:flex-row"><input id="agent-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Codex on laptop" className={inputClass} /><button type="submit" disabled={pending} className={`shrink-0 ${buttonPrimary}`}>{pending ? "Creating…" : "Create token"}</button></div></form>
    </section>
  );
}
