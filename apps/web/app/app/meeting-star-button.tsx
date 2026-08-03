"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MeetingStarButton({
  meetingId,
  starred,
}: {
  meetingId: string;
  starred: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [optimistic, setOptimistic] = useState(starred);

  async function toggle() {
    const next = !optimistic;
    setOptimistic(next);
    setPending(true);
    const response = await fetch(`/api/meetings/${meetingId}/star`, {
      method: next ? "PUT" : "DELETE",
    });
    setPending(false);
    if (!response.ok) {
      setOptimistic(!next);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => void toggle()}
      aria-label={optimistic ? "Remove from starred" : "Add to starred"}
      aria-pressed={optimistic}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep ${
        optimistic
          ? "bg-sage-fill text-sage-deep"
          : "text-stone hover:bg-sage-fill hover:text-sage-deep"
      }`}
    >
      <span aria-hidden="true">{optimistic ? "★" : "☆"}</span>
    </button>
  );
}
