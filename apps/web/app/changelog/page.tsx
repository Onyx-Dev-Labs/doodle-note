import Image from "next/image";
import Link from "next/link";

export const metadata = { title: "What's new — DoodleNote" };

/** One entry per released desktop version, newest first. */
const RELEASES: Array<{
  version: string;
  date: string;
  highlights: string[];
}> = [
  {
    version: "0.2.3",
    date: "July 7, 2026",
    highlights: [
      "Google Calendar: connect your Google account alongside (or instead of) Microsoft 365 — same Coming-up card, menu-bar countdown, and meeting-start prompts",
      "Sign in with Google on the web dashboard",
      "Incoming-call prompts appear within ~5 seconds of the ring (was up to 13)",
      "Exactly one prompt per meeting — no more stacked notifications covering each other",
      "Notarized by Apple: DoodleNote now installs cleanly on any Mac",
      "Version number in Settings links to this page",
    ],
  },
  {
    version: "0.2.0",
    date: "July 7, 2026",
    highlights: [
      "Instant recording start — transcription models stay loaded, so hitting record (or accepting a meeting prompt) begins transcribing immediately",
      "Incoming call detection: DoodleNote offers to take notes while Zoom, Teams, or FaceTime is still ringing — and Slack huddles count too",
      "Recording stops by itself when the meeting app hangs up, and notes generate on their own",
      "Note templates: Customer discovery, Site survey, Troubleshooting, 1:1, Standup, Interview — pick per meeting, switch and regenerate anytime",
      "Share links: publish a read-only page of any meeting's notes and transcript with one click",
      "Full-text search across notes and transcripts, on the desktop and the web library",
      "Quick notes: standalone notes with the same editor, formatting toolbar, images, and optional voice dump",
      "Dark mode on the desktop app and this website",
      "Team workspaces: invite members by link; everyone sees the workspace's synced meetings",
      "Images in notes sync to the cloud and appear on shared pages",
      "Signed and auto-updating: the app now updates itself in the background",
    ],
  },
  {
    version: "0.1.0",
    date: "July 5, 2026",
    highlights: [
      "First release: no-bot meeting capture on your Mac — mic plus system audio, transcribed entirely on-device",
      "AI meeting notes from your rough bullets and the transcript, using a local model (or your own API key)",
      "Ask anything about a meeting — or across all your meetings — with cited answers",
      "Microsoft 365 calendar: Coming up card, menu-bar countdown, meeting-start prompts",
      "Folders, trash, and a cloud dashboard with meetings library and Microsoft sign-in",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <header className="border-b border-sand bg-card-soft">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/mascot.png" alt="" width={26} height={26} className="rounded-md" />
            <span className="text-sm font-bold tracking-tight">
              <span className="text-ink">Doodle</span>
              <span className="text-sage">Note</span>
            </span>
          </Link>
          <span className="text-xs text-stone">What&rsquo;s new</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          What&rsquo;s new
        </h1>
        <p className="mt-2 text-sm text-stone">
          Every DoodleNote release and what changed. The app updates itself —
          you&rsquo;re always on the newest version within a few hours.
        </p>

        <div className="mt-10 space-y-10">
          {RELEASES.map((release) => (
            <section key={release.version} id={`v${release.version}`}>
              <div className="flex items-baseline gap-3">
                <h2 className="text-xl font-semibold text-ink">
                  v{release.version}
                </h2>
                <span className="text-sm text-stone">{release.date}</span>
              </div>
              <ul className="mt-3 space-y-2 rounded-xl border border-sand bg-card p-6">
                {release.highlights.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
                    <span className="mt-0.5 shrink-0 text-sage" aria-hidden="true">
                      •
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>

      <footer className="border-t border-sand">
        <div className="mx-auto w-full max-w-3xl px-6 py-5 text-sm text-stone">
          <Link href="/" className="font-semibold text-sage-deep hover:underline">
            DoodleNote
          </Link>{" "}
          — AI meeting notes without the bot.
        </div>
      </footer>
    </div>
  );
}
