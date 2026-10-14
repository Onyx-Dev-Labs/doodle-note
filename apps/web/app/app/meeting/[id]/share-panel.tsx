"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";

interface Recipient {
  id: string;
  email: string;
  createdAt: string;
}

interface ShareState {
  includeTranscript: boolean;
  link: { url: string; expiresAt: string | null } | null;
  recipients: Recipient[];
  workspace: { name: string; personal: boolean; memberCount: number };
}

interface ErrorBody {
  error?: string;
  code?: string;
}

const EXPIRY_OPTIONS = [
  { value: "0", label: "Never" },
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const;

const fieldClass =
  "rounded-lg border border-sand bg-card px-3 py-2 text-sm text-ink placeholder:text-stone focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep disabled:opacity-60";
const secondaryButton =
  "shrink-0 rounded-lg border border-sand bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep disabled:opacity-50";

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body;
}

/**
 * The meeting's one Share panel (web; the desktop ShareDialog mirrors it):
 * add people by email, see who has access (the workspace first), choose
 * general access (only people added, or anyone with the link, with an
 * optional expiry), and one Include transcript setting for everyone.
 * Every change saves immediately.
 */
export function SharePanel({
  meetingId,
  title,
  onClose,
}: {
  meetingId: string;
  title: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const shareEndpoint = `/api/meetings/${meetingId}/share`;
  const recipientsEndpoint = `/api/meetings/${meetingId}/recipients`;
  const [state, setState] = useState<ShareState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emails, setEmails] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  /** Expiry chosen in this session; null shows the saved date as-is. */
  const [expiryChoice, setExpiryChoice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(shareEndpoint, { cache: "no-store" })
      .then((response) => readJson<ShareState>(response, "Could not load sharing"))
      .then((body) => {
        if (!cancelled) setState(body);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(caught instanceof Error ? caught.message : "Could not load sharing");
      });
    return () => {
      cancelled = true;
    };
  }, [shareEndpoint]);

  async function run(key: string, action: () => Promise<string | null>) {
    setBusy(key);
    setStatus(null);
    try {
      const text = await action();
      if (text) setStatus({ text, error: false });
    } catch (caught) {
      setStatus({ text: caught instanceof Error ? caught.message : "Something went wrong", error: true });
    } finally {
      setBusy(null);
    }
  }

  async function updateSettings(change: {
    includeTranscript?: boolean;
    link?: "on" | "off";
    expiresInDays?: number;
  }): Promise<ShareState> {
    const response = await fetch(shareEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    });
    const next = await readJson<ShareState>(response, "Could not save sharing");
    setState(next);
    return next;
  }

  async function addPeople() {
    setAddError(null);
    setBusy("add");
    setStatus(null);
    try {
      const response = await fetch(recipientsEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const body = (await response.json().catch(() => ({}))) as ErrorBody & {
        added?: Recipient[];
        recipients?: Recipient[];
      };
      if (!response.ok) {
        setAddError(body.error ?? "Could not share the meeting");
        return;
      }
      setState((current) => (current ? { ...current, recipients: body.recipients ?? [] } : current));
      setEmails("");
      const count = body.added?.length ?? 0;
      setStatus({ text: `Shared with ${count} ${count === 1 ? "person" : "people"}. They'll get an email.`, error: false });
    } catch {
      setAddError("Could not reach DoodleNote. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  function removePerson(recipient: Recipient) {
    void run(`remove:${recipient.id}`, async () => {
      const response = await fetch(`${recipientsEndpoint}?recipientId=${encodeURIComponent(recipient.id)}`, {
        method: "DELETE",
      });
      const body = await readJson<{ recipients?: Recipient[] }>(response, "Could not remove access");
      setState((current) => (current ? { ...current, recipients: body.recipients ?? [] } : current));
      return `Removed ${recipient.email}.`;
    });
  }

  function setGeneralAccess(value: string) {
    const on = value === "link";
    void run("access", async () => {
      setExpiryChoice(null);
      await updateSettings({ link: on ? "on" : "off" });
      router.refresh();
      return on ? "Link is on. Anyone with it can view." : "Link turned off.";
    });
  }

  function setExpiry(value: string) {
    void run("expiry", async () => {
      const next = await updateSettings({ expiresInDays: Number(value) });
      setExpiryChoice(value);
      return next.link?.expiresAt ? `Link expires ${formatExpiry(next.link.expiresAt)}.` : "Link never expires.";
    });
  }

  function setTranscript(includeTranscript: boolean) {
    void run("transcript", async () => {
      await updateSettings({ includeTranscript });
      return includeTranscript ? "Transcript included for everyone." : "Notes only for everyone.";
    });
  }

  async function copyLink() {
    if (!state?.link) return;
    try {
      await navigator.clipboard.writeText(state.link.url);
      setStatus({ text: "Link copied.", error: false });
    } catch {
      setStatus({ text: "Clipboard access was blocked. Select the link and copy it.", error: true });
    }
  }

  const headingId = `${ids}-heading`;
  const emailsId = `${ids}-emails`;
  const addErrorId = `${ids}-add-error`;
  const accessId = `${ids}-access`;
  const transcriptId = `${ids}-transcript`;
  const link = state?.link ?? null;
  const expiryValue = link?.expiresAt ? (expiryChoice ?? "current") : "0";
  const disabled = busy !== null;

  return (
    <section aria-labelledby={headingId} className="mt-4 rounded-xl border border-sand bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="min-w-0 font-display text-base font-semibold text-ink">
          Share <span className="break-words">“{title}”</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sharing"
          className="rounded-md px-2 py-1 text-stone hover:bg-sage-fill hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep"
        >
          ×
        </button>
      </div>

      {loadError ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{loadError}</p>
      ) : !state ? (
        <p className="mt-3 text-xs text-stone">Loading…</p>
      ) : (
        <>
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void addPeople();
            }}
          >
            <label htmlFor={emailsId} className="block text-xs font-medium text-bark">
              Add people
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id={emailsId}
                type="text"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                value={emails}
                onChange={(event) => {
                  setEmails(event.target.value);
                  if (addError) setAddError(null);
                }}
                placeholder="name@example.com, …"
                aria-invalid={addError ? true : undefined}
                aria-describedby={addError ? addErrorId : undefined}
                className={`${fieldClass} min-w-0 flex-1`}
              />
              <button
                type="submit"
                disabled={disabled || !emails.trim()}
                className="shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-cream hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep disabled:opacity-50"
              >
                {busy === "add" ? "Adding…" : "Add"}
              </button>
            </div>
            {addError ? (
              <p id={addErrorId} role="alert" className="mt-1.5 text-xs text-red-700 dark:text-red-300">{addError}</p>
            ) : (
              <p className="mt-1.5 text-[11px] text-stone">Separate addresses with commas or spaces. People added can view, copy and export, but not edit.</p>
            )}
          </form>

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-stone">Who has access</h3>
          <ul className="mt-2 space-y-1.5">
            <li className="flex items-center gap-2 rounded-lg bg-card-soft px-3 py-2">
              <span className="min-w-0 flex-1">
                {state.workspace.personal ? (
                  <>
                    <span className="block truncate text-sm text-ink">You · Owner</span>
                    <span className="block text-[11px] text-stone">Your Personal workspace</span>
                  </>
                ) : (
                  <>
                    <span className="block truncate text-sm text-ink">Everyone in {state.workspace.name}</span>
                    <span className="block text-[11px] text-stone">
                      {state.workspace.memberCount} {state.workspace.memberCount === 1 ? "member" : "members"} · Workspace
                    </span>
                  </>
                )}
              </span>
            </li>
            {state.recipients.map((recipient) => (
              <li key={recipient.id} className="flex items-center gap-2 rounded-lg bg-card-soft px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink" title={recipient.email}>{recipient.email}</span>
                  <span className="block text-[11px] text-stone">Can view</span>
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removePerson(recipient)}
                  aria-label={`Remove ${recipient.email}`}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"
                >
                  {busy === `remove:${recipient.id}` ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-stone">
            <label htmlFor={accessId}>General access</label>
          </h3>
          <select
            id={accessId}
            value={link ? "link" : "people"}
            disabled={disabled}
            onChange={(event) => setGeneralAccess(event.target.value)}
            className={`${fieldClass} mt-2 w-full`}
          >
            <option value="people">Only people added</option>
            <option value="link">Anyone with the link</option>
          </select>
          <p className="mt-1.5 text-[11px] text-stone">
            {link
              ? "Anyone on the internet with the link can view. No sign-in needed."
              : state.workspace.personal
                ? "Only you and people you add can open it."
                : `Only ${state.workspace.name} and people you add can open it.`}
          </p>
          {link && (
            <div className="mt-3 rounded-lg bg-card-soft p-3">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={link.url}
                  aria-label="Share link"
                  onFocus={(event) => event.target.select()}
                  className={`${fieldClass} min-w-0 flex-1 text-xs`}
                />
                <button type="button" onClick={() => void copyLink()} className={secondaryButton}>
                  Copy link
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-stone">
                <label htmlFor={`${ids}-expiry`}>Link expires</label>
                <select
                  id={`${ids}-expiry`}
                  value={expiryValue}
                  disabled={disabled}
                  onChange={(event) => {
                    if (event.target.value !== "current") setExpiry(event.target.value);
                  }}
                  className="rounded-md border border-sand bg-card px-2 py-1 text-xs text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep disabled:opacity-60"
                >
                  {expiryValue === "current" && <option value="current">On a set date</option>}
                  {EXPIRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {link.expiresAt && <span>{formatExpiry(link.expiresAt)}</span>}
              </div>
            </div>
          )}

          <div className="mt-5 flex items-start justify-between gap-3 border-t border-sand pt-4">
            <span className="min-w-0">
              <span id={transcriptId} className="block text-sm font-medium text-ink">Include transcript</span>
              <span className="block text-[11px] leading-relaxed text-stone">
                For everyone above{link ? " and anyone with the link" : ""}. Off: people see the notes only.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={state.includeTranscript}
              aria-labelledby={transcriptId}
              disabled={disabled}
              onClick={() => setTranscript(!state.includeTranscript)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep disabled:opacity-60 ${state.includeTranscript ? "bg-sage-deep" : "bg-sand"}`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-4 w-4 rounded-full bg-card shadow transition-transform ${state.includeTranscript ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
          </div>
        </>
      )}

      <p
        aria-live="polite"
        className={`text-sm ${status ? "mt-3" : ""} ${status?.error ? "text-red-700 dark:text-red-300" : "text-sage-deep"}`}
      >
        {status?.text}
      </p>
    </section>
  );
}
