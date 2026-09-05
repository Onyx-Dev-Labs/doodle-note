import { SiteFooter, SiteHeader } from "../ui";

export const metadata = { title: "What's new — DoodleNote" };

/** One entry per released desktop version, newest first. */
const RELEASES: Array<{
  version: string;
  date: string;
  highlights: string[];
}> = [
  {
    version: "0.4.22",
    date: "September 5, 2026",
    highlights: [
      "Fix Windows recording finalization so the local transcript refinement pass can finish",
      "Protect recordings started immediately after launch and preserve system-audio speaker labels",
      "Cancel stalled update downloads and retry from Settings without exposing internal errors",
    ],
  },
  {
    version: "0.4.21",
    date: "September 4, 2026",
    highlights: [
      "Improve Windows transcript accuracy with a private, on-device final pass after recording",
      "Keep live captions, speaker labels, timestamps, and saved audio while the final wording is refined",
      "Use the same higher-accuracy Windows transcription path for imported recordings",
    ],
  },
  {
    version: "0.4.20",
    date: "September 4, 2026",
    highlights: [
      "Restore Check for updates for Windows beta installations",
      "Replace internal updater diagnostics with a short, readable error message",
    ],
  },
  {
    version: "0.4.19",
    date: "September 4, 2026",
    highlights: [
      "Preserve the final spoken words when stopping a Windows recording",
      "Prevent delayed microphone starts and switches from crossing recording sessions",
      "Show recording readiness and microphone switch failures accurately on Windows",
      "Route Windows beta update checks through the Windows beta release feed",
    ],
  },
  {
    version: "0.4.18",
    date: "September 1, 2026",
    highlights: [
      "Import MP4 video recordings and transcribe their audio into a meeting",
      "Play and seek imported MP4 recordings after restarting DoodleNote",
      "Show a clear error when an MP4 has no supported audio track",
    ],
  },
  {
    version: "0.4.17",
    date: "August 30, 2026",
    highlights: [
      "Keep to-do checkboxes, checked state, and nested task structure when reopening formatted notes",
    ],
  },
  {
    version: "0.4.16",
    date: "August 28, 2026",
    highlights: [
      "Checkpoint transcripts during recording so an unexpected quit cannot erase an entire meeting transcript",
      "Show Transcribe recording when saved audio needs its transcript rebuilt",
      "Turn an unavailable Generate notes button into a direct Notes model setup action",
      "Keep Groq, OpenRouter, and Ollama notes settings active after restarting DoodleNote",
    ],
  },
  {
    version: "0.4.15",
    date: "August 28, 2026",
    highlights: [
      "Keep to-do checkboxes and checked state when reopening regular notes and meeting notes",
    ],
  },
  {
    version: "0.4.14",
    date: "August 27, 2026",
    highlights: [
      "Remove the retired G Brain export from Settings and the desktop application",
      "Keep Claude Desktop, Claude Code, Codex, and other MCP agent integrations available",
    ],
  },
  {
    version: "0.4.13",
    date: "August 26, 2026",
    highlights: [
      "Cloud sync no longer re-pulls your entire library on every app restart",
      "Sync reconciliation waits for the first cloud snapshot before trashing local meetings that look missing",
      "Connecting DoodleNote to the cloud on doodlenote.ai sign-in is more reliable again",
    ],
  },
  {
    version: "0.4.12",
    date: "August 7, 2026",
    highlights: [
      "Add your name in Settings so your side of transcripts is labeled consistently instead of You",
      "Rename the other speaker once and apply that name throughout the entire meeting transcript",
      "Generated meeting notes and Ask now use the resolved speaker names when attributing what people said",
    ],
  },
  {
    version: "0.4.11",
    date: "August 3, 2026",
    highlights: [
      "The Mac app icon now uses the same edge-to-edge sage background as iPhone, without black side gutters",
      "The matching mascot inside DoodleNote now uses the corrected opaque artwork too",
      "Website Mac downloads now open a familiar drag-to-Applications installer",
    ],
  },
  {
    version: "0.4.10",
    date: "August 3, 2026",
    highlights: [
      "Resize the Mac app down to a compact 800 × 560 window for smaller screens and side-by-side setups",
      "Meeting prompts now send one native Mac notification while keeping the Start taking notes action available inside DoodleNote",
      "The corrected full-bleed app icon now refreshes reliably after an in-place update",
    ],
  },
  {
    version: "0.4.9",
    date: "August 2, 2026",
    highlights: [
      "The Mac app icon now fills its rounded shape cleanly, with no pale side gutters",
    ],
  },
  {
    version: "0.4.8",
    date: "August 1, 2026",
    highlights: [
      "Create a meeting, note, or audio import from one streamlined New menu",
      "Empty new notes and meetings now ask whether to save, discard, or keep editing before they close",
      "Untitled notes receive a useful title derived from their notes, transcript, or attachment context",
      "Home stays focused on the last seven days, with older meetings available in manageable batches",
    ],
  },
  {
    version: "0.4.7",
    date: "August 1, 2026",
    highlights: [
      "Meeting action menus now stay above every note row, so Move to trash, exports, and folder actions cannot be obscured or intercepted by another meeting",
    ],
  },
  {
    version: "0.4.6",
    date: "August 1, 2026",
    highlights: [
      "Meeting prompts now appear only once: calendar reminders and live call detection coordinate instead of nudging you separately",
      "Zoom Phone ringing, notification sounds, and other output-only activity no longer look like active meetings",
      "Starting a recording clears any outstanding prompt, and background prompts no longer reappear as a second banner when you open DoodleNote",
    ],
  },
  {
    version: "0.4.5",
    date: "July 14, 2026",
    highlights: [
      "Mac: DoodleNote no longer needs the Screen Recording permission — system audio is captured with a Core Audio tap (macOS 14.2+), so setup only asks for microphone and system-audio access",
      "Every recording checks the new capture is actually hearing audio and falls back to the old method automatically if it isn't",
      "Prefer the old capture? Settings → General → Meeting recordings has the switch",
    ],
  },
  {
    version: "0.4.4",
    date: "July 13, 2026",
    highlights: [
      "Export any meeting as Markdown or PDF from the note's ⋯ menu",
      "Bring your own key: Groq, OpenRouter, and Ollama join OpenAI and Anthropic as notes-model providers — Ollama needs no key at all",
    ],
  },
  {
    version: "0.4.2",
    date: "July 12, 2026",
    highlights: [
      "Long meetings get full-coverage notes — transcripts over ~40 minutes are condensed in parts so nothing in the middle is skipped anymore",
      "First-run setup wizard: permissions, the transcription engine, and your notes model, all set up before your first meeting",
    ],
  },
  {
    version: "0.4.1",
    date: "July 12, 2026",
    highlights: [
      "Import audio files (wav, mp3, m4a) from the home screen — DoodleNote transcribes them into a meeting",
      "Re-transcribe any meeting from its saved recording",
      "Recordings made by DoodleNote recover the You/Them speaker split on import",
    ],
  },
  {
    version: "0.4.0",
    date: "July 11, 2026",
    highlights: [
      "Meeting audio is saved on your Mac (local only, never synced) — play it back from the transcript panel and click any line to jump there",
      "Crash recovery: if DoodleNote quits mid-meeting, the recording is stitched back together on next launch",
      "Stopping a recording responds instantly, and Resume continues the clock where it left off",
    ],
  },
  {
    version: "0.3.5",
    date: "July 7, 2026",
    highlights: [
      "Mac: microphone picker in the meeting bar \u2014 choose any input device, switch mid-recording, and DoodleNote falls back to the default mic if your chosen one goes silent (thanks Alec!)",
      "Mac only for now \u2014 Windows stays on 0.3.4 until the next cross-platform release",
      "All in-app links now point at doodlenote.ai",
    ],
  },
  {
    version: "0.3.4",
    date: "July 7, 2026",
    highlights: [
      "Folders sync: your Spaces, and which folder each meeting is in, now travel to every linked device — folder deletions move meetings back to My notes everywhere",
      "Windows: brand-new full-bleed sage icon — no more black edges on the desktop or taskbar",
      "Fixed: the \u201cquit unexpectedly\u201d dialog when installing an update on Mac",
      "Developer console moved out of the sidebar into Settings \u2192 General \u2192 Troubleshooting",
    ],
  },
  {
    version: "0.3.3",
    date: "July 7, 2026",
    highlights: [
      "Two-way sync: meetings recorded on one computer now appear on every device linked to your workspace — deletions travel too (to Trash, always recoverable)",
      "Fixed: \u201cfailed to load the model\u201d on Windows — note generation now falls back to CPU automatically when the GPU can\u2019t fit the model",
    ],
  },
  {
    version: "0.3.2",
    date: "July 7, 2026",
    highlights: [
      "Windows: recording now stops and notes generate automatically when your meeting ends, and DoodleNote offers to take notes when a meeting app grabs the mic — same as Mac",
      "Paw prints! Generating notes now shows a trot of paw prints and doodle-flavored phrases instead of a word counter",
      "Fixed: \u201cCheck for updates\u201d could report stale versions (the update feed was cached too aggressively)",
      "Fixed: the Windows desktop icon showed black corners; Settings copy no longer says \u201cMac\u201d on Windows",
    ],
  },
  {
    version: "0.3.1",
    date: "July 7, 2026",
    highlights: [
      "Welcome tour: a first-run walkthrough of recording, calendars, meeting detection, cloud sync, and notes models — replay it anytime from Settings → General",
      "Fixed: the Windows app icon showed the default Electron logo instead of the DoodleNote mascot",
    ],
  },
  {
    version: "0.3.0",
    date: "July 7, 2026",
    highlights: [
      "DoodleNote for Windows (beta): recording, on-device transcription, AI notes, calendar, cloud sync — the whole app on your PC",
      "Windows transcription runs a streaming zipformer model via sherpa-onnx; the speech model downloads automatically on first launch",
      "Windows captures your mic and system audio (what the other side says) natively — no bot joins your call, same as on Mac",
    ],
  },
  {
    version: "0.2.5",
    date: "July 7, 2026",
    highlights: [
      "Microsoft and Google logos on the calendar connect/disconnect buttons",
    ],
  },
  {
    version: "0.2.4",
    date: "July 7, 2026",
    highlights: [
      "Settings → General → Updates: see your version, check for updates on demand, watch the download, and click Restart to update",
      "Fixed: downloaded updates could fail to install on quit — the new Restart button is the reliable path",
    ],
  },
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
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-24 pt-10 sm:pt-16">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
          What&rsquo;s new
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-stone">
          Every DoodleNote release and what changed. The app updates itself —
          you&rsquo;re always on the newest version within a few hours.
        </p>

        <div className="mt-8">
          {RELEASES.map((release) => (
            <section
              key={release.version}
              id={`v${release.version}`}
              className="grid gap-2 border-b border-sand py-8 last:border-b-0 sm:grid-cols-[8rem_1fr] sm:gap-6"
            >
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  v{release.version}
                </h2>
                <p className="mt-0.5 text-xs text-stone">{release.date}</p>
              </div>
              <ul className="space-y-2.5">
                {release.highlights.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2.5 text-sm leading-relaxed"
                  >
                    <span
                      className="mt-0.5 shrink-0 text-sage"
                      aria-hidden="true"
                    >
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

      <SiteFooter />
    </div>
  );
}
