import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone">DoodleNote</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">Settings</h1>
      </div>
      <div className="mt-7 grid w-full min-w-0 gap-7 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="w-full min-w-0 overflow-hidden"><SettingsNav /></aside>
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
