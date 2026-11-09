import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { helpCategories, helpGuides } from "../../content/help-guides";
import { COMMUNITY_URL } from "../../lib/community";

export const metadata: Metadata = {
  alternates: { canonical: "https://www.doodlenote.ai/help" },
};

const startingPoints = [
  {
    slug: "first-meeting",
    title: "Your first meeting",
    description: "From pressing record to finding the good stuff.",
    number: "01",
    icon: "record",
  },
  {
    slug: "bark",
    title: "Let Bark do the typing",
    description: "A shortcut, a few words, and a little less typing.",
    number: "02",
    icon: "bark",
  },
  {
    slug: "ai-notes",
    title: "Make more of your notes",
    description: "Turn the conversation into clear next steps.",
    number: "03",
    icon: "notes",
  },
  {
    slug: "sync",
    title: "Take your notes with you",
    description: "Connect Cloud Sync when you’re ready.",
    number: "04",
    icon: "sync",
  },
];

function GuideIcon({ name }: { name: string }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "record" && (
        <>
          <rect x="8" y="3" width="8" height="12" rx="4" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
        </>
      )}
      {name === "bark" && (
        <>
          <path d="M4 9v6m4-10v14m4-16v18m4-16v14m4-10v6" />
        </>
      )}
      {name === "notes" && (
        <>
          <path d="M15 3H5v18h14V7M8 8h4m-4 4h8m-8 4h5m2-13v4h4z" />
        </>
      )}
      {name === "sync" && (
        <>
          <path d="M6 17a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11M9 20l3 3 3-3m-3-7v10" />
        </>
      )}
    </svg>
  );
}

export default function HelpHome() {
  return (
    <main id="help-main" className="help-home" tabIndex={-1}>
      <section className="help-hero">
        <div>
          <p className="help-eyebrow">THE DOODLENOTE FIELD GUIDE</p>
          <h1>
            A little guidance.
            <br />
            <em>A lot of good ideas.</em>
          </h1>
          <p>
            Find your feet, capture the conversation, and make the most of what
            comes next.
          </p>
          <Link href="/help/install" className="help-text-link">
            New here? Let’s get you started <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="help-hero-note" aria-hidden="true">
          <span className="help-note-tape" />
          <Image src="/mascot.png" width={92} height={92} alt="" priority />
          <span>
            A little help,
            <br />
            right when you need it.
          </span>
          <svg viewBox="0 0 130 16" fill="none">
            <path
              d="M3 10Q60 0 125 8M14 14Q65 7 115 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </section>
      <section className="help-start" aria-labelledby="help-start-title">
        <div className="help-section-heading">
          <h2 id="help-start-title">A good place to start.</h2>
          <span>Small steps. Useful things.</span>
        </div>
        <div className="help-start-grid">
          {startingPoints.map((item) => (
            <Link
              className={`help-start-card help-start-${item.icon}`}
              href={`/help/${item.slug}`}
              key={item.slug}
            >
              <div className="help-card-top">
                <span className="help-card-icon">
                  <GuideIcon name={item.icon} />
                </span>
                <span className="help-card-number">{item.number}</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <span className="help-card-link">
                Read the guide <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="help-topics" aria-labelledby="help-topics-title">
        <div className="help-section-heading">
          <h2 id="help-topics-title">Find your next step.</h2>
          <span>All {helpGuides.length} guides</span>
        </div>
        <div className="help-topics-grid">
          {helpCategories.map((category) => (
            <div className="help-topic" key={category}>
              <h3>{category}</h3>
              <ul>
                {helpGuides
                  .filter((guide) => guide.category === category)
                  .map((guide) => (
                    <li key={guide.slug}>
                      <Link href={`/help/${guide.slug}`}>
                        {guide.title}
                        <span aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <section className="help-human">
        <div>
          <h2>Still need a hand?</h2>
          <p>
            Ask questions, share ideas, and find a little extra help in our
            Discord community.
          </p>
        </div>
        <div className="help-human-actions">
          <a
            href={COMMUNITY_URL}
            className="help-button"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Join our community on Discord (opens in a new tab)"
          >
            Join our community <span aria-hidden="true">→</span>
          </a>
          <Link href="/contact" className="help-text-link">
            Contact the team <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
      <footer className="help-page-footer">
        <span>Made for a little more headspace.</span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/changelog">What’s new</Link>
      </footer>
    </main>
  );
}
