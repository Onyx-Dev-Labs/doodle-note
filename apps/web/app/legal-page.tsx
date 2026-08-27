import { SiteFooter, SiteHeader } from "./ui";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream text-bark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-20 pt-10">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-2 text-sm text-stone">Effective {updated}</p>
        <div className="mt-10 space-y-8 text-[0.95rem] leading-7">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
