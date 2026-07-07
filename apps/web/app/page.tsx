import Image from "next/image";
import Link from "next/link";
import { AppleLogo, WindowsLogo } from "./logos";

function Wordmark({ size = "text-lg" }: { size?: string }) {
  return (
    <span className={`${size} font-display font-bold tracking-tight`}>
      <span className="text-ink">Doodle</span>
      <span className="text-sage">Note</span>
    </span>
  );
}

/** Update feed on Vercel Blob — publish-release.mjs uploads these. */
const DOWNLOADS = {
  mac: "https://z4d0oe5bcxlyzvar.public.blob.vercel-storage.com/updates/DoodleNote-0.3.4-arm64-mac.zip",
  win: "https://z4d0oe5bcxlyzvar.public.blob.vercel-storage.com/updates/DoodleNote-0.3.4-setup.exe",
};

const REASONS = [
  {
    title: "No bot joins your call",
    body: "Nothing appears in the participant list and nobody gets a “recording started” warning about you. DoodleNote listens from your side, on your computer, in any app that makes sound.",
  },
  {
    title: "Your audio is never uploaded",
    body: "Transcription runs entirely on your device. Meeting audio never touches our servers — or anyone else’s. There is nothing to leak, because nothing is sent.",
  },
  {
    title: "The AI is yours",
    body: "Notes are written by a local model you download once, in-app. Prefer a frontier model? Bring your own API key — your key, your data, no middleman.",
  },
  {
    title: "Free, without a catch",
    body: "Unlimited meetings, transcripts, AI notes, and search on your device — no account required. Pay only if you want your notes synced across devices.",
  },
];

function DownloadButtons({ small = false }: { small?: boolean }) {
  const pad = small ? "px-4 py-2" : "px-5 py-2.5";
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <a
        href={DOWNLOADS.mac}
        className={`inline-flex items-center justify-center gap-2 rounded-lg bg-ink ${pad} text-sm font-medium text-cream transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep`}
      >
        <AppleLogo className="-mt-0.5 h-4 w-4" />
        Download for macOS
      </a>
      <a
        href={DOWNLOADS.win}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-sand bg-card ${pad} text-sm font-medium text-ink transition-colors hover:bg-sage-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep`}
      >
        <WindowsLogo className="h-3.5 w-3.5" />
        Windows (beta)
      </a>
    </div>
  );
}

/** Hand-drawn underline for the headline's key phrase. */
function DoodleStroke() {
  return (
    <svg
      className="doodle-stroke absolute -bottom-2 left-0 h-3 w-full text-sage"
      viewBox="0 0 300 12"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M4 8.5C42 4.5 96 3 150 5c46 1.7 92 2.5 146-1.5"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The whole product in one card: messy jot in, polished notes out. */
function NotepadDemo() {
  return (
    <figure className="w-full max-w-2xl overflow-hidden rounded-2xl border border-sand bg-card shadow-[0_1px_0_var(--color-sand),0_12px_32px_-20px_rgba(38,40,31,0.35)]">
      <div className="grid sm:grid-cols-2">
        <div className="notepad-rule border-b border-sand px-6 pb-5 pt-4 sm:border-b-0 sm:border-r">
          <figcaption className="text-xs font-semibold uppercase tracking-wider text-stone">
            You, mid-call
          </figcaption>
          <p className="mt-3 font-hand text-[1.45rem] leading-8 text-bark">
            pricing?? john wants Q3
            <br />
            demo went well &mdash; latency q
            <br />
            they need SSO before rollout
            <br />
            priya = decision maker
          </p>
        </div>
        <div className="settle-in px-6 pb-5 pt-4">
          <figcaption className="text-xs font-semibold uppercase tracking-wider text-sage-deep">
            DoodleNote, right after
          </figcaption>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-bark">
            <p>
              <strong className="text-ink">Decisions</strong>
              <br />
              Pricing review moves to Q3, owned by John.
            </p>
            <p>
              <strong className="text-ink">Action items</strong>
              <br />
              Send SSO setup docs to Priya (decision maker).
              <br />
              Book the follow-up demo &mdash; latency question came up.
            </p>
          </div>
        </div>
      </div>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <Image
            src="/mascot.png"
            alt=""
            width={34}
            height={34}
            className="rounded-lg"
            priority
            unoptimized
          />
          <Wordmark />
        </div>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/pricing"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-bark transition-colors hover:bg-sage-fill hover:text-ink"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-sand bg-card px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-sage-fill"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center px-6">
        {/* Hero */}
        <section className="flex w-full max-w-2xl flex-col items-center pb-16 pt-16 text-center sm:pt-24">
          <h1 className="font-display text-4xl font-semibold leading-[1.12] tracking-tight text-ink sm:text-[3.4rem]">
            Polished notes from every meeting.{" "}
            <span className="relative inline-block whitespace-nowrap text-sage-deep">
              Nothing
              <DoodleStroke />
            </span>{" "}
            leaves your computer.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-bark">
            DoodleNote listens from your side of the call &mdash; no bot in the
            room, no audio uploaded. Jot rough fragments while you talk; it
            merges them with the on-device transcript into notes worth sharing.
          </p>
          <div className="mt-9">
            <DownloadButtons />
          </div>
          <p className="mt-4 text-sm text-stone">
            Free forever &middot; Works with any meeting app
          </p>
        </section>

        {/* The product, in one glance */}
        <section className="flex w-full justify-center pb-24">
          <NotepadDemo />
        </section>

        {/* Why this, and not the usual notetaker */}
        <section className="w-full max-w-2xl pb-24">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Why people switch
          </h2>
          <dl className="mt-2">
            {REASONS.map((r) => (
              <div
                key={r.title}
                className="grid gap-1 border-b border-sand py-6 last:border-b-0 sm:grid-cols-[13rem_1fr] sm:gap-8"
              >
                <dt className="font-display text-base font-semibold text-ink">
                  {r.title}
                </dt>
                <dd className="text-[0.95rem] leading-relaxed text-bark">
                  {r.body}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-sm text-stone">
            Sync across devices, share links, and team workspaces are $10/month
            when you want them.{" "}
            <Link
              href="/pricing"
              className="font-medium text-sage-deep hover:underline"
            >
              See pricing
            </Link>
          </p>
        </section>

        {/* Final CTA */}
        <section className="flex w-full max-w-2xl flex-col items-center border-t border-sand pb-20 pt-16 text-center">
          <Image
            src="/mascot.png"
            alt=""
            width={52}
            height={52}
            className="rounded-xl"
            unoptimized
          />
          <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink">
            Bring it to your next meeting
          </h2>
          <p className="mt-2 max-w-md text-bark">
            Download, hit record, and watch your jottings come back as real
            notes.
          </p>
          <div className="mt-7">
            <DownloadButtons small />
          </div>
          <p className="mt-4 text-sm text-stone">
            macOS on Apple Silicon &middot; Windows 10/11 (64-bit)
          </p>
        </section>
      </main>

      <footer className="border-t border-sand">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-stone sm:flex-row">
          <Wordmark size="text-sm" />
          <nav className="flex items-center gap-5">
            <Link href="/pricing" className="hover:text-ink">
              Pricing
            </Link>
            <Link href="/changelog" className="hover:text-ink">
              What&rsquo;s new
            </Link>
            <Link href="/login" className="hover:text-ink">
              Sign in
            </Link>
          </nav>
          <span>Local-first. Your meetings never leave your device.</span>
        </div>
      </footer>
    </div>
  );
}
