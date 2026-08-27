import Link from "next/link";

import { CheckoutButton } from "./checkout-button";
import {
  DoodleStroke,
  DownloadButtons,
  GitHubNavLink,
  navLinkClass,
  navPillClass,
  SiteFooter,
  SiteHeader,
} from "../ui";

export const metadata = { title: "Pricing — DoodleNote" };

const FREE_FEATURES = [
  "Unlimited meetings and recording — no caps, ever",
  "No-bot capture of mic + system audio on Mac and PC",
  "On-device transcription — audio never leaves your computer",
  "AI notes from a local model, or bring your own API key",
  "Ask anything about one meeting or across all of them, with citations",
  "Microsoft 365 and Google Calendar, meeting-start prompts",
  "Note templates, quick notes, folders, and full-text search",
  "Automatic updates",
];

const SYNC_FEATURES = [
  "Everything in Free",
  "Your meetings synced across every device, both ways",
  "Web library — read and search your notes from any browser",
  "Share any meeting as a read-only link",
  "Team workspaces — invite by link, share one meeting memory",
  "Images in notes synced and shown on shared pages",
];

const FAQ = [
  {
    q: "Is the free plan really free forever?",
    a: "Yes. Recording, transcription, and AI notes all run on your own computer — they cost us nothing to provide, so we will never cap your meetings or put your own notes behind a paywall.",
  },
  {
    q: "What exactly am I paying for with Sync?",
    a: "Servers and storage. Sync keeps an encrypted-in-transit copy of your meetings in the cloud so every device you link stays up to date, powers the web library and share links, and hosts your team's shared workspace.",
  },
  {
    q: "What happens if I cancel Sync?",
    a: "Nothing dramatic. Your notes stay on your devices in full — DoodleNote is local-first, so canceling just stops the syncing. You can re-subscribe anytime and pick up where you left off.",
  },
  {
    q: "Do you train AI on my meetings?",
    a: "No. Transcription and note generation happen on your device. If you enable Sync, your data is used only to power sync, search, and sharing — never for training, never sold.",
  },
  {
    q: "Do I need a ChatGPT or Claude subscription?",
    a: "No. DoodleNote downloads a local model in-app that writes your notes for free. If you prefer a frontier model, you can plug in your own OpenAI or Anthropic API key.",
  },
  {
    q: "Is DoodleNote open source?",
    a: "Yes. The whole monorepo — desktop, iPhone, and the sync server — is MIT at github.com/Onyx-Dev-Labs/doodle-note. Official hosted Sync at doodlenote.ai is still $10 / user / month. Forks must not use the DoodleNote name or mascot.",
  },
];

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-4">
      {items.map((item) => (
        <li
          key={item}
          className="flex gap-3 border-b border-sand py-3 text-sm leading-relaxed text-bark last:border-b-0"
        >
          <span className="mt-0.5 shrink-0 text-sage" aria-hidden="true">
            ✓
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function PricingPage() {
  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <SiteHeader
        nav={
          <>
            <Link href="/changelog" className={navLinkClass}>
              What&rsquo;s new
            </Link>
            <GitHubNavLink />
            <Link href="/login" className={navPillClass}>
              Sign in
            </Link>
          </>
        }
      />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-24 pt-10 sm:pt-16">
        <div className="text-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
            <span className="relative inline-block whitespace-nowrap text-sage-deep">
              Free
              <DoodleStroke />
            </span>{" "}
            forever. Pay only for sync.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-bark">
            Everything that runs on your device — recording, transcription, AI
            notes — is free with no meeting caps. Sync is for when you want
            your notes everywhere.
          </p>
        </div>

        {/* Free */}
        <section className="mt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
              Free
            </h2>
            <p className="font-display text-2xl font-semibold tracking-tight text-ink">
              $0{" "}
              <span className="text-sm font-normal text-stone">forever</span>
            </p>
          </div>
          <p className="mt-1 text-sm text-stone">
            The whole notepad, on your device — no account required
          </p>
          <FeatureList items={FREE_FEATURES} />
          <div className="mt-7 flex justify-center sm:justify-start">
            <DownloadButtons small />
          </div>
        </section>

        {/* Sync */}
        <section className="mt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="flex items-baseline gap-2.5 font-display text-2xl font-semibold tracking-tight text-ink">
              Sync
              <span className="rounded-full bg-sage-fill px-2.5 py-0.5 text-xs font-medium text-sage-deep">
                Early access
              </span>
            </h2>
            <p className="font-display text-2xl font-semibold tracking-tight text-ink">
              $10{" "}
              <span className="text-sm font-normal text-stone">
                / user / month
              </span>
            </p>
          </div>
          <p className="mt-1 text-sm text-stone">
            Your meetings on every device
          </p>
          <FeatureList items={SYNC_FEATURES} />
          <div className="mt-7">
            <CheckoutButton />
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-20">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Questions, answered
          </h2>
          <dl className="mt-2">
            {FAQ.map((item) => (
              <div
                key={item.q}
                className="border-b border-sand py-6 last:border-b-0"
              >
                <dt className="font-display text-base font-semibold text-ink">
                  {item.q}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-bark">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
