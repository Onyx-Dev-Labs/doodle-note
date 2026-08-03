"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { buttonPrimary, inputClass } from "../../../ui";

interface InvitationRow {
  id: string;
  email: string;
  role: "member" | "admin";
  expiresAt: string;
}

export function InvitationsPanel({ organizationId, personal, emailDeliveryEnabled, invitations }: { organizationId: string; personal: boolean; emailDeliveryEnabled: boolean; invitations: InvitationRow[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [pending, setPending] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const target = email.trim();
    if (!target) return;
    setError(null);
    setMessage(null);
    setPending(true);
    const result = await authClient.organization.inviteMember({ email: target, role, organizationId });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not create the invitation");
      return;
    }
    setEmail("");
    setMessage(emailDeliveryEnabled ? "Invitation created and email delivery requested." : "Invitation created. Copy the link below to send it manually.");
    router.refresh();
  }

  async function resend(invitation: InvitationRow) {
    setError(null);
    setMessage(null);
    setPendingId(invitation.id);
    const result = await authClient.organization.inviteMember({ email: invitation.email, role: invitation.role, organizationId, resend: true });
    setPendingId(null);
    if (result.error) {
      setError(result.error.message ?? "Could not resend the invitation");
      return;
    }
    setMessage(emailDeliveryEnabled ? "Invitation email requested again." : "Invitation refreshed. Copy its new link below.");
    router.refresh();
  }

  async function cancel(invitationId: string) {
    setError(null);
    setPendingId(invitationId);
    const result = await authClient.organization.cancelInvitation({ invitationId });
    setPendingId(null);
    if (result.error) {
      setError(result.error.message ?? "Could not cancel the invitation");
      return;
    }
    router.refresh();
  }

  async function copy(invitationId: string) {
    const url = `${window.location.origin}/invite/${invitationId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invitationId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError(url);
    }
  }

  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-ink">Invitations</h2>
      <p className="mt-1 text-sm text-stone">Invite teammates, resend access, or cancel links that should no longer work.</p>
      {!emailDeliveryEnabled && !personal && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">Email delivery is not configured on this deployment. Invitations still work through the copyable secure link.</p>}
      {personal && <p className="mt-4 rounded-lg bg-sage-fill px-3 py-2 text-sm text-sage-deep">Personal is private. Switch to a team workspace before inviting members.</p>}
      {(message || error) && <p aria-live="polite" className={`mt-4 text-sm ${error ? "text-red-700 dark:text-red-300" : "text-sage-deep"}`}>{error ?? message}</p>}

      {!personal && (
        <form onSubmit={invite} className="mt-5 rounded-xl border border-sand bg-card p-4">
          <label className="block text-xs font-medium text-bark" htmlFor="invite-email">Email address</label>
          <div className="mt-1 grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_auto]">
            <input id="invite-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@company.com" className={inputClass} />
            <label className="sr-only" htmlFor="invite-role">Role</label>
            <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "member")} className={inputClass}><option value="member">Member</option><option value="admin">Admin</option></select>
            <button type="submit" disabled={pending || !email.trim()} className={buttonPrimary}>{pending ? "Inviting…" : "Invite"}</button>
          </div>
        </form>
      )}

      {invitations.length === 0 ? (
        <p className="mt-8 text-sm text-stone">No pending invitations.</p>
      ) : (
        <ul className="mt-5 overflow-hidden rounded-xl border border-sand bg-card">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex flex-col justify-between gap-3 border-b border-sand p-4 last:border-b-0 sm:flex-row sm:items-center">
              <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{invitation.email}</p><p className="mt-0.5 text-xs capitalize text-stone">{invitation.role} · Expires {new Date(invitation.expiresAt).toLocaleDateString()}</p></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy(invitation.id)} className="rounded-lg border border-sand px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill">{copiedId === invitation.id ? "Copied" : "Copy link"}</button>
                <button type="button" disabled={pendingId === invitation.id} onClick={() => void resend(invitation)} className="rounded-lg border border-sand px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill disabled:opacity-50">Resend</button>
                <button type="button" disabled={pendingId === invitation.id} onClick={() => void cancel(invitation.id)} className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950">Cancel</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
