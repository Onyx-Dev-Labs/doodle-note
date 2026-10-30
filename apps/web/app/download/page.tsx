import type { Metadata } from "next";
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
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sage-deep">
              Free download
            </p>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
              Get DoodleNote.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-bark">
              The app is free: recording, transcription, and AI notes run on
              your computer, with no meeting caps and no account.
            </p>
            <p className="mt-3 text-base leading-relaxed text-bark">
              Cloud Sync is an optional paid add-on for syncing and sharing. You
              never need it to use DoodleNote.{" "}
              <Link
                href="/pricing"
                className="font-medium text-sage-deep hover:underline"
              >
                See pricing
              </Link>
            </p>
            <div className="mt-8 border-l-2 border-sage pl-4 text-sm leading-relaxed text-stone">
              No password and no card. Enter your email and your download starts
              right away.
            </div>
          </div>
          <div className="download-form-shell">
            <DownloadForm initialPlatform={platform} />
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
