import Image from "next/image";
import Link from "next/link";

function Wordmark({ size = "text-lg" }: { size?: string }) {
  return (
    <span className={`${size} font-bold tracking-tight`}>
      <span className="text-ink">Doodle</span>
      <span className="text-sage">Note</span>
    </span>
  );
}

const FEATURES = [
  {
    title: "No bot in your meetings",
    body: "DoodleNote captures mic and system audio right on your computer. Nothing joins the call, nothing announces itself — your meetings stay yours.",
  },
  {
    title: "On-device transcription",
    body: "Two-channel local transcription knows who said what: your mic is “You,” the other side is “Them.” Fast, accurate, and fully offline.",
  },
  {
    title: "AI notes, locally",
    body: "Your rough notes merge with the transcript into polished summaries using a local model downloaded in-app — or bring your own API key.",
  },
  {
    title: "Calendar-aware",
    body: "One-click Microsoft 365 sign-in shows what's coming up, counts down in your menu bar, and offers to start recording when a meeting begins.",
  },
];

/** Update feed on Vercel Blob — publish-release.mjs uploads these. */
const DOWNLOADS = {
  mac: "https://z4d0oe5bcxlyzvar.public.blob.vercel-storage.com/updates/DoodleNote-0.2.5-arm64-mac.zip",
  win: "https://z4d0oe5bcxlyzvar.public.blob.vercel-storage.com/updates/DoodleNote-0.3.0-setup.exe",
};

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
        <Link
          href="/login"
          className="rounded-md border border-sand bg-card px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-sage-fill"
        >
          Sign in
        </Link>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 pb-16 pt-20 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            AI meeting notes,
            <br />
            <span className="text-sage-deep">without the bot.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-bark">
            DoodleNote captures your meetings right on your Mac or PC,
            transcribes them on-device, and turns your rough notes into
            polished summaries with local AI. Private by default.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <a
              href={DOWNLOADS.mac}
              className="rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-cream transition-opacity hover:opacity-85"
            >
              Download for macOS
            </a>
            <a
              href={DOWNLOADS.win}
              className="rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-cream transition-opacity hover:opacity-85"
            >
              Download for Windows (beta)
            </a>
            <Link
              href="/login"
              className="rounded-md border border-sand bg-card px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sage-fill"
            >
              Open the web dashboard
            </Link>
          </div>
          <p className="mt-4 text-sm text-stone">
            macOS on Apple Silicon · Windows 10/11 (64-bit). Nothing leaves
            your device unless you opt into cloud sync.
          </p>
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 pb-24">
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-sand bg-card-soft p-6"
              >
                <h2 className="text-base font-semibold text-ink">{f.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-bark">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-sand">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 text-sm text-stone">
          <Wordmark size="text-sm" />
          <span>Local-first. Your meetings never leave your device.</span>
        </div>
      </footer>
    </div>
  );
}
