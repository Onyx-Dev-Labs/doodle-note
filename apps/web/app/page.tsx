import Link from "next/link";

export default function Home() {
  return (
    <>
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-sm font-semibold tracking-tight">
          Doodle Note
        </span>
        <Link
          href="/login"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Sign in
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Doodle Note
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-300">
          AI meeting notes without the bot
        </p>
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          web app coming soon &mdash; notes viewer, workspaces, sharing
        </p>
      </main>
    </>
  );
}
