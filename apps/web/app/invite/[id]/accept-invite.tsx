"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export function AcceptInvite({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setError(null);
    setPending(true);
    const result = await authClient.organization.acceptInvitation({
      invitationId,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not accept the invitation");
      return;
    }
    await authClient.organization.setActive({
      organizationId: result.data.invitation.organizationId,
    });
    router.push("/app");
    router.refresh();
  }

  return (
    <>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => void accept()}
        className="mt-4 w-full rounded-md bg-ink px-3 py-2 text-sm font-medium text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Joining…" : "Join workspace"}
      </button>
    </>
  );
}
