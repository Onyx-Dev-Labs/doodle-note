import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "../ui";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact DoodleNote",
  description: "Contact the DoodleNote team with a question or message.",
};

export default function ContactPage() {
  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <SiteHeader />
      <main className="flex flex-1 items-start px-6 pb-20 pt-12 sm:pt-20">
        <section className="mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sage-deep">
              Contact us
            </p>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
              Tell us what you need.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-bark">
              Questions about DoodleNote, Cloud Sync, privacy, or getting
              started are welcome. Send us the details and we will reply by
              email.
            </p>
            <div className="mt-8 border-l-2 border-sage pl-4 text-sm leading-relaxed text-stone">
              Prefer email? Write directly to{" "}
              <a
                href="mailto:team@onyxdev.io"
                className="font-medium text-sage-deep underline decoration-sage/50 underline-offset-2 hover:decoration-sage-deep"
              >
                team@onyxdev.io
              </a>
              .
            </div>
          </div>
          <ContactForm />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
