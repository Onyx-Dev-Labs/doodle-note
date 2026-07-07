import Image from "next/image";
import Link from "next/link";
import { AppleLogo, WindowsLogo } from "../logos";

export const metadata = { title: "Pricing — DoodleNote" };

/** Update feed on Vercel Blob — publish-release.mjs uploads these. */
const DOWNLOADS = {
  mac: "https://z4d0oe5bcxlyzvar.public.blob.vercel-storage.com/updates/DoodleNote-0.3.3-arm64-mac.zip",
  win: "https://z4d0oe5bcxlyzvar.public.blob.vercel-storage.com/updates/DoodleNote-0.3.3-setup.exe",
};

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
];

export default function PricingPage() {
  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <header className="border-b border-sand bg-card-soft">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/mascot.png"
              alt=""
              width={26}
              height={26}
              className="rounded-md"
            />
            <span className="text-sm font-bold tracking-tight">
              <span className="text-ink">Doodle</span>
              <span className="text-sage">Note</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/changelog"
              className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-bark transition-colors hover:bg-sage-fill hover:text-ink sm:block"
            >
              What&rsquo;s new
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-sand bg-card px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-sage-fill"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-14">
        <div className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-ink">
            Free forever. Pay only for sync.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-bark">
            Everything that runs on your device — recording, transcription, AI
            notes — is free with no meeting caps. Sync is for when you want
            your notes everywhere.
          </p>
        </div>

        <div className="mx-auto mt-12 grid w-full max-w-4xl gap-5 lg:grid-cols-2">
          {/* Free */}
          <div className="flex flex-col rounded-2xl border border-sand bg-card p-8">
            <h2 className="text-lg font-semibold text-ink">Free</h2>
            <p className="mt-1 text-sm text-stone">
              The whole notepad, on your device
            </p>
            <p className="mt-5 text-4xl font-semibold tracking-tight text-ink">
              $0
              <span className="text-base font-normal text-stone"> forever</span>
            </p>
            <ul className="mt-6 flex-1 space-y-2.5">
              {FREE_FEATURES.map((item) => (
                <li
                  key={item}
                  className="flex gap-2.5 text-sm leading-relaxed"
                >
                  <span className="mt-0.5 shrink-0 text-sage" aria-hidden="true">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-2.5">
              <a
                href={DOWNLOADS.mac}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-ink px-5 py-2.5 text-center text-sm font-medium text-cream transition-opacity hover:opacity-85"
              >
                <AppleLogo className="h-4 w-4 -mt-0.5" />
                Download for macOS
              </a>
              <a
                href={DOWNLOADS.win}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-sand bg-card px-5 py-2.5 text-center text-sm font-medium text-ink transition-colors hover:bg-sage-fill"
              >
                <WindowsLogo className="h-3.5 w-3.5" />
                Download for Windows (beta)
              </a>
            </div>
          </div>

          {/* Sync */}
          <div className="relative flex flex-col rounded-2xl border-2 border-sage bg-card p-8">
            <span className="absolute -top-3 right-6 rounded-full bg-sage px-3 py-0.5 text-xs font-semibold text-cream">
              Early access
            </span>
            <h2 className="text-lg font-semibold text-ink">Sync</h2>
            <p className="mt-1 text-sm text-stone">
              Your meetings on every device
            </p>
            <p className="mt-5 text-4xl font-semibold tracking-tight text-ink">
              $10
              <span className="text-base font-normal text-stone">
                {" "}
                / user / month
              </span>
            </p>
            <ul className="mt-6 flex-1 space-y-2.5">
              {SYNC_FEATURES.map((item) => (
                <li
                  key={item}
                  className="flex gap-2.5 text-sm leading-relaxed"
                >
                  <span className="mt-0.5 shrink-0 text-sage" aria-hidden="true">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-2.5">
              <Link
                href="/login"
                className="rounded-md bg-sage-deep px-5 py-2.5 text-center text-sm font-medium text-cream transition-opacity hover:opacity-85"
              >
                Get started
              </Link>
              <p className="text-center text-xs text-stone">
                Free during early access — billing starts when Sync leaves
                beta.
              </p>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <section className="mx-auto mt-20 w-full max-w-3xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-ink">
            Questions, answered
          </h2>
          <div className="mt-8 space-y-4">
            {FAQ.map((item) => (
              <div
                key={item.q}
                className="rounded-xl border border-sand bg-card-soft p-6"
              >
                <h3 className="text-sm font-semibold text-ink">{item.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-bark">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-sand">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 text-sm text-stone">
          <Link href="/" className="font-semibold text-sage-deep hover:underline">
            DoodleNote
          </Link>
          <span>Local-first. Your meetings never leave your device.</span>
        </div>
      </footer>
    </div>
  );
}
