"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

interface MemberRow {
  id: string;
  email: string;
  role: string;
  currentUser: boolean;
}

export function MembersPanel({ organizationId, personal, members }: { organizationId: string; personal: boolean; members: MemberRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateRole(memberId: string, role: string) {
    setError(null);
    setPendingId(memberId);
    const result = await authClient.organization.updateMemberRole({ memberId, role, organizationId });
    setPendingId(null);
    if (result.error) {
      setError(result.error.message ?? "Could not update the member role");
      return;
    }
    router.refresh();
  }

  async function remove(memberId: string) {
    setError(null);
    setPendingId(memberId);
    const result = await authClient.organization.removeMember({ memberIdOrEmail: memberId, organizationId });
    setPendingId(null);
    if (result.error) {
      setError(result.error.message ?? "Could not remove the member");
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-ink">Members</h2>
      <p className="mt-1 text-sm text-stone">Manage roles and transfer ownership by promoting a trusted member to Owner. DoodleNote prevents removal of a workspace’s last owner.</p>
      {personal && <p className="mt-4 rounded-lg bg-sage-fill px-3 py-2 text-sm text-sage-deep">Your Personal workspace is private and does not need additional members.</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <ul className="mt-5 overflow-hidden rounded-xl border border-sand bg-card">
        {members.map((member) => (
          <li key={member.id} className="flex flex-col justify-between gap-3 border-b border-sand p-4 last:border-b-0 sm:flex-row sm:items-center">
            <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{member.email}{member.currentUser ? " (you)" : ""}</p><p className="mt-0.5 text-xs capitalize text-stone">{member.role}</p></div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.email}</label>
              <select id={`role-${member.id}`} value={member.role} disabled={pendingId === member.id || personal} onChange={(event) => void updateRole(member.id, event.target.value)} className="rounded-lg border border-sand bg-card px-3 py-2 text-sm text-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
              {!member.currentUser && !personal && <button type="button" disabled={pendingId === member.id} onClick={() => void remove(member.id)} className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950">Remove</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
