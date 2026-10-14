"use client";

import { useEffect, useState } from "react";

interface Recipient {
  id: string;
  email: string;
  includeTranscript: boolean;
  createdAt: string;
}

interface RecipientsResponse {
  error?: string;
  recipients?: Recipient[];
  added?: Recipient[];
}

/**
 * Owner-side "Share with people" panel: give specific people read-only access
 * by email. The list never indicates whether an address has an account.
 */
export function ShareWithPeople({ meetingId }: { meetingId: string }) {
  const endpoint = `/api/meetings/${meetingId}/recipients`;
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [emails, setEmails] = useState("");
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as RecipientsResponse;
        if (!response.ok) throw new Error(body.error ?? "Could not load people with access");
        if (!cancelled) setRecipients(body.recipients ?? []);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not load people with access");
        setRecipients([]);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  async function share() {
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emails, includeTranscript }),
      });
      const body = (await response.json()) as RecipientsResponse;
      if (!response.ok) throw new Error(body.error ?? "Could not share the meeting");
      setRecipients(body.recipients ?? []);
      const count = body.added?.length ?? 0;
      setMessage(`Shared with ${count} ${count === 1 ? "person" : "people"}. They'll get an email.`);
      setEmails("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not share the meeting");
    } finally {
      setPending(false);
    }
  }

  async function remove(recipient: Recipient) {
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      const response = await fetch(`${endpoint}?recipientId=${encodeURIComponent(recipient.id)}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as RecipientsResponse;
      if (!response.ok) throw new Error(body.error ?? "Could not remove access");
      setRecipients(body.recipients ?? []);
      setMessage(`Removed ${recipient.email}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove access");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-sand bg-card p-4" aria-label="Share with people">
      <h2 className="font-display text-base font-semibold text-ink">Share with people</h2>
      <p className="mt-1 text-xs leading-relaxed text-stone">
        People you add can read this meeting in their own DoodleNote account. They can copy and export it, but can&apos;t edit or reshare it.
      </p>
      <form
        className="mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void share();
        }}
      >
        <label className="block text-xs font-medium text-bark" htmlFor={`share-emails-${meetingId}`}>
          Email addresses
        </label>
        <textarea
          id={`share-emails-${meetingId}`}
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
          rows={2}
          placeholder="name@example.com, teammate@example.com"
          className="mt-1 w-full resize-y rounded-lg border border-sand bg-card px-3 py-2 text-sm text-ink placeholder:text-stone focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep"
        />
        <label className="mt-3 flex items-start gap-2 text-sm text-bark">
          <input
            type="checkbox"
            checked={includeTranscript}
            onChange={(event) => setIncludeTranscript(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-sage-deep"
          />
          <span>
            <strong className="text-ink">Include transcript</strong>
            <span className="block text-xs text-stone">Turn off to share only the notes.</span>
          </span>
        </label>
        <button
          type="submit"
          disabled={pending || !emails.trim()}
          className="mt-3 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-cream disabled:opacity-50"
        >
          {pending ? "Saving…" : "Share"}
        </button>
      </form>

      {(message || error) && (
        <p aria-live="polite" className={`mt-3 text-sm ${error ? "text-red-700 dark:text-red-300" : "text-sage-deep"}`}>
          {error ?? message}
        </p>
      )}

      <div className="mt-4 border-t border-sand pt-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone">People with access</p>
        {recipients === null ? (
          <p className="mt-2 text-xs text-stone">Loading…</p>
        ) : recipients.length === 0 ? (
          <p className="mt-2 text-xs text-stone">Only people in this workspace can see this meeting.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {recipients.map((recipient) => (
              <li key={recipient.id} className="flex items-center justify-between gap-2 rounded-lg bg-card-soft px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{recipient.email}</span>
                  <span className="block text-[11px] text-stone">
                    Can view · {recipient.includeTranscript ? "Notes and transcript" : "Notes only"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void remove(recipient)}
                  aria-label={`Remove ${recipient.email}`}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
