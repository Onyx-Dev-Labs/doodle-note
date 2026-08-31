"use client";

import { useRef, useState } from "react";

import { buttonPrimary, inputClass } from "../ui";

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function ContactForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const startedAt = useRef<number | null>(null);
  const [state, setState] = useState<FormState>({ kind: "idle" });

  function recordInteraction() {
    startedAt.current ??= Date.now();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "submitting") return;

    setState({ kind: "submitting" });
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fields, startedAt: startedAt.current ?? 0 }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "Your message could not be sent right now. Please try again.",
        );
      }

      formRef.current?.reset();
      startedAt.current = null;
      setState({ kind: "success" });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Your message could not be sent right now. Please try again.",
      });
    }
  }

  const pending = state.kind === "submitting";

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onFocusCapture={recordInteraction}
      onPointerDownCapture={recordInteraction}
      className="rounded-xl border border-sand bg-card p-5 shadow-[0_12px_32px_-24px_rgba(38,40,31,0.35)] sm:p-7"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink" htmlFor="name">
          Name
          <input
            className={`mt-1.5 ${inputClass}`}
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <label className="block text-sm font-medium text-ink" htmlFor="email">
          Email
          <input
            className={`mt-1.5 ${inputClass}`}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label className="block text-sm font-medium text-ink" htmlFor="company">
          Company <span className="font-normal text-stone">(optional)</span>
          <input
            className={`mt-1.5 ${inputClass}`}
            id="company"
            name="company"
            type="text"
            autoComplete="organization"
            maxLength={120}
          />
        </label>
        <label className="block text-sm font-medium text-ink" htmlFor="phone">
          Phone <span className="font-normal text-stone">(optional)</span>
          <input
            className={`mt-1.5 ${inputClass}`}
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
          />
        </label>
      </div>

      <label className="mt-5 block text-sm font-medium text-ink" htmlFor="message">
        How can we help?
        <textarea
          className={`mt-1.5 min-h-40 resize-y ${inputClass}`}
          id="message"
          name="message"
          minLength={10}
          maxLength={5_000}
          required
        />
      </label>

      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          className={buttonPrimary}
          disabled={pending}
        >
          {pending ? "Sending…" : "Send message"}
        </button>
        <p
          className={`text-sm ${state.kind === "error" ? "text-red-700 dark:text-red-300" : "text-sage-deep"}`}
          role={state.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {state.kind === "success"
            ? "Thanks. Your message has been sent to the DoodleNote team."
            : state.kind === "error"
              ? state.message
              : "We normally reply by email."}
        </p>
      </div>
    </form>
  );
}
