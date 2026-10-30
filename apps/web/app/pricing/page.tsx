import { MarketingLayout, MarketingDownloadButtons } from "../marketing";
import { CheckoutButton } from "./checkout-button";
import "../marketing.css";
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
    <ul className="plan-features">
      {items.map((item) => (
        <li key={item}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12l4 4L19 6" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  return (
    <MarketingLayout className="pricing-page">
      <main id="main" className="pricing-main wrap">
        <section className="pricing-intro">
          <div className="eyebrow">A LITTLE CLARITY ON PRICING</div>
          <h1>
            Free on your device.
            <br />
            <span className="handwritten">Pay only for sync.</span>
          </h1>
          <p>
            Capture the conversation. Keep your thoughts together.
            <br /> Add Sync when you want your notes everywhere.
          </p>
        </section>
        <section className="plans" aria-label="DoodleNote plans">
          <article className="plan-card">
            <div className="plan-kicker">YOUR OWN LITTLE NOTEBOOK</div>
            <div className="plan-heading">
              <h2>Free</h2>
              <div>
                <strong>$0</strong>
                <span>forever</span>
              </div>
            </div>
            <p className="plan-description">
              No account required. No meeting caps.
            </p>
            <FeatureList items={FREE_FEATURES} />
            <MarketingDownloadButtons className="plan-downloads" />
            <p className="plan-footnote">
              Email signup required · macOS and Windows beta
            </p>
          </article>
          <article className="plan-card sync-plan">
            <div className="plan-kicker">A NOTEBOOK THAT COMES WITH YOU</div>
            <div className="plan-heading">
              <h2>Sync</h2>
              <div>
                <strong>$10</strong>
                <span>per user / month</span>
              </div>
            </div>
            <p className="plan-description">
              Your thoughts, wherever you pick up next.
            </p>
            <FeatureList items={SYNC_FEATURES} />
            <div className="marketing-checkout">
              <CheckoutButton autoCheckout={checkout === "1"} />
            </div>
          </article>
        </section>
        <section className="pricing-faq">
          <div>
            <p className="eyebrow">GOOD TO KNOW</p>
            <h2>A few small details.</h2>
            <span className="handwritten">your notes stay yours.</span>
          </div>
          <div className="faq-list">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
