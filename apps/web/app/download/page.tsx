import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { isDownloadPlatform } from "@/lib/download-consent";

import { MarketingLayout } from "../marketing";
import "../marketing.css";
import { DownloadForm } from "./download-form";

export const metadata: Metadata = {
  title: "Download DoodleNote — free for macOS and Windows",
  description:
    "Download the free DoodleNote app. Recording, transcription, and AI notes run on your computer. Cloud Sync is optional.",
  alternates: { canonical: "/download" },
};

export default async function DownloadPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string | string[] }>;
}) {
  const requested = (await searchParams).platform;
  const platform = isDownloadPlatform(requested) ? requested : "mac";

  return (
    <MarketingLayout className="download-page">
      <main id="main" className="download-main wrap">
        <section className="download-grid">
          <div className="download-intro">
            <p className="eyebrow">YOUR FREE DESKTOP NOTEBOOK</p>
            <h1>
              Make room for
              <br />
              <span className="download-handwritten">the good stuff.</span>
            </h1>
            <p className="download-description">
              The app is free: recording, transcription, and AI notes run on
              your computer, with no meeting caps and no account.
            </p>
            <ul
              className="download-promises"
              aria-label="Included with DoodleNote"
            >
              <li>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3 20 6v6c0 4-5 8-8 9-3-1-8-5-8-9V6Z" />
                  <path d="m8 12 3 3 5-6" />
                </svg>
                On-device transcription
              </li>
              <li>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 4h14v16H5zM2 8h6M2 12h6M2 16h6M11 9h4M11 13h4" />
                </svg>
                Unlimited meetings
              </li>
            </ul>
            <div className="download-keepsake">
              <div className="download-sticky">
                <span className="download-sticky-kicker">
                  A LITTLE REMINDER
                </span>
                <p>
                  Be there.
                  <br />
                  We’ll keep the notes.
                </p>
                <svg viewBox="0 0 90 24" aria-hidden="true">
                  <path d="M3 15q33-14 83-5M8 21q37-12 72-5" />
                </svg>
              </div>
              <div className="download-mascot">
                <Image
                  src="/mascot.png"
                  alt=""
                  width={114}
                  height={114}
                  unoptimized
                />
                <span className="handwritten">got you covered.</span>
              </div>
            </div>
            <p className="download-sync-note">
              Cloud Sync is an optional paid add-on for syncing and sharing. You
              never need it to use DoodleNote.{" "}
              <Link href="/pricing">See pricing</Link>
            </p>
          </div>
          <section
            className="download-card"
            aria-labelledby="download-card-title"
          >
            <div className="download-card-topline">
              <span>LET’S GET YOU SET UP</span>
              <span>01 / 01</span>
            </div>
            <header className="download-card-heading">
              <h2 id="download-card-title">Your next page starts here.</h2>
              <p>No password. No card. Just a little headspace.</p>
            </header>
            <div className="download-form-shell">
              <DownloadForm initialPlatform={platform} />
            </div>
          </section>
        </section>
      </main>
    </MarketingLayout>
  );
}
