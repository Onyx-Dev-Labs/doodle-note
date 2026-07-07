import Image from "next/image";
import Link from "next/link";
import { AppleLogo, WindowsLogo } from "./logos";

function Wordmark({ size = "text-lg" }: { size?: string }) {
  return (
    <span className={`${size} font-bold tracking-tight`}>
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

const MEETING_APPS = [
  "Zoom",
  "Google Meet",
  "Teams",
  "Slack huddles",
  "FaceTime",
];

const TIMELINE = [
  {
    phase: "Before",
    title: "It knows your calendar",
    body: "Connect Microsoft 365 or Google Calendar and DoodleNote shows what's coming up, counts down in your menu bar, and offers to take notes the moment your meeting app starts ringing.",
  },
  {
    phase: "During",
    title: "You just jot",
    body: "Recording starts instantly and a live transcript builds in the background — your mic is “You,” the other side is “Them.” Type messy half-thoughts; that's all DoodleNote needs.",
  },
  {
    phase: "After",
    title: "Polished notes, on their own",
    body: "When the call ends, recording stops by itself and your rough jottings merge with the transcript into clean, structured notes — summary, decisions, action items. Share them with one link.",
  },
];

const PRIVACY_POINTS = [
  {
    title: "No bot joins your call",
    body: "DoodleNote captures your mic and system audio right on your computer. Nothing announces itself, nothing sits in the participant list.",
  },
  {
    title: "Transcription never leaves your device",
    body: "Speech-to-text runs entirely on your Mac or PC. Your meeting audio is never uploaded to us — or anyone else.",
  },
  {
    title: "AI notes with a local model",
    body: "Notes are written by a local model downloaded in-app. Prefer frontier models? Bring your own API key — it's your key, your data.",
  },
  {
    title: "Sync is opt-in, always",
    body: "Out of the box, everything stays on your device. Turn on cloud sync only if you want your notes on every device — and turn it off anytime.",
  },
];

const FEATURES = [
  {
    title: "Ask your meetings anything",
    body: "Chat with one meeting or across all of them — “what did we promise the customer?” — and get grounded answers with citations back to the transcript.",
  },
  {
    title: "Note templates",
    body: "Customer discovery, 1:1, standup, interview, troubleshooting — pick a template per meeting, switch and regenerate anytime.",
  },
  {
    title: "Share with a link",
    body: "Publish a read-only page of any meeting's notes and transcript with one click. No account needed to read it.",
  },
  {
    title: "Team workspaces",
    body: "Invite your team by link and everyone sees the workspace's synced meetings — one shared memory for the whole team.",
  },
  {
    title: "Full-text search",
    body: "Search every word ever said across notes and transcripts, on your desktop and in the web library.",
  },
  {
    title: "Quick notes & folders",
    body: "Standalone notes with the same editor, images, and optional voice dump. Organize everything with folders and a recoverable trash.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <Image
            src="/mascot.png"
            alt=""
            width={34}
            height={34}
            className="rounded-lg"
            priority
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
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 pb-14 pt-16 text-center sm:pt-20">
          <p className="rounded-full border border-sand bg-card px-3.5 py-1 text-xs font-medium text-sage-deep">
            Unlimited meetings, free forever
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            AI meeting notes.
            <br />
            <span className="text-sage-deep">No bot. No cloud.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-bark">
            DoodleNote records right on your Mac or PC, transcribes on-device,
            and turns your rough jottings into polished notes, action items,
            and answers. Your meetings never leave your computer.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <a
              href={DOWNLOADS.mac}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-cream transition-opacity hover:opacity-85"
            >
              <AppleLogo className="h-4 w-4 -mt-0.5" />
              Download for macOS
            </a>
            <a
              href={DOWNLOADS.win}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-sand bg-card px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sage-fill"
            >
              <WindowsLogo className="h-3.5 w-3.5" />
              Download for Windows (beta)
            </a>
          </div>
          <p className="mt-4 text-sm text-stone">
            Works with {MEETING_APPS.join(", ")} — any app that makes sound.
          </p>
        </section>

        {/* Trust strip */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-20">
          <div className="grid gap-px overflow-hidden rounded-xl border border-sand bg-sand sm:grid-cols-3">
            {[
              ["0", "bots joining your calls"],
              ["100%", "on-device transcription"],
              ["$0", "for unlimited meetings"],
            ].map(([stat, label]) => (
              <div
                key={label}
                className="flex flex-col items-center bg-card-soft px-6 py-6 text-center"
              >
                <span className="text-3xl font-semibold tracking-tight text-sage-deep">
                  {stat}
                </span>
                <span className="mt-1 text-sm text-bark">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Before / during / after */}
        <section className="border-y border-sand bg-card-soft">
          <div className="mx-auto w-full max-w-5xl px-6 py-20">
            <h2 className="text-center text-3xl font-semibold tracking-tight text-ink">
              Before, during, and after every meeting
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-bark">
              DoodleNote handles the note-taking so you can actually be in the
              conversation.
            </p>
            <div className="mt-12 grid gap-4 sm:grid-cols-3">
              {TIMELINE.map((step) => (
                <div
                  key={step.phase}
                  className="rounded-xl border border-sand bg-card p-6"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-sage">
                    {step.phase}
                  </span>
                  <h3 className="mt-2 text-base font-semibold text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-bark">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Privacy — the differentiator */}
        <section className="mx-auto w-full max-w-5xl px-6 py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-ink">
                Private by design,
                <br />
                not by promise
              </h2>
              <p className="mt-4 leading-relaxed text-bark">
                Other AI notetakers upload your meeting audio to their servers
                and process it there. DoodleNote is built the other way around:
                capture, transcription, and AI all run on your own computer.
                There is nothing to leak, because nothing is sent.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {PRIVACY_POINTS.map((p) => (
                <div
                  key={p.title}
                  className="rounded-xl border border-sand bg-card-soft p-5"
                >
                  <h3 className="text-sm font-semibold text-ink">{p.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-bark">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Feature grid */}
        <section className="border-y border-sand bg-card-soft">
          <div className="mx-auto w-full max-w-5xl px-6 py-20">
            <h2 className="text-center text-3xl font-semibold tracking-tight text-ink">
              A real notepad, not just a recorder
            </h2>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-sand bg-card p-6"
                >
                  <h3 className="text-base font-semibold text-ink">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-bark">
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="mx-auto w-full max-w-5xl px-6 py-20">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-ink">
            Free forever. Pay only for sync.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-bark">
            Everything that runs on your device is free with no meeting caps.
            Add Sync when you want your notes on every device.
          </p>
          <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-sand bg-card p-6">
              <h3 className="text-base font-semibold text-ink">Free</h3>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
                $0
                <span className="text-sm font-normal text-stone"> forever</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-bark">
                Unlimited recording, on-device transcription, AI notes, chat,
                calendars, templates, and search — all local, no account
                required.
              </p>
            </div>
            <div className="rounded-xl border-2 border-sage bg-card p-6">
              <h3 className="text-base font-semibold text-ink">Sync</h3>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
                $10
                <span className="text-sm font-normal text-stone">
                  {" "}
                  / month
                </span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-bark">
                Everything in Free, plus your meetings on every device, the web
                library, share links, and team workspaces.
              </p>
            </div>
          </div>
          <p className="mt-6 text-center">
            <Link
              href="/pricing"
              className="text-sm font-medium text-sage-deep hover:underline"
            >
              Compare plans in detail →
            </Link>
          </p>
        </section>

        {/* Final CTA */}
        <section className="border-t border-sand bg-card-soft">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 py-16 text-center">
            <Image
              src="/mascot.png"
              alt=""
              width={52}
              height={52}
              className="rounded-xl"
            />
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-ink">
              Bring DoodleNote to your next meeting
            </h2>
            <p className="mt-3 max-w-md text-bark">
              Download, hit record, and see your rough jottings come back as
              real notes.
            </p>
            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row">
              <a
                href={DOWNLOADS.mac}
                className="rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-cream transition-opacity hover:opacity-85"
              >
                Download for macOS
              </a>
              <a
                href={DOWNLOADS.win}
                className="rounded-md border border-sand bg-card px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sage-fill"
              >
                Download for Windows (beta)
              </a>
            </div>
            <p className="mt-4 text-sm text-stone">
              macOS on Apple Silicon · Windows 10/11 (64-bit)
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-sand">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-stone sm:flex-row">
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
