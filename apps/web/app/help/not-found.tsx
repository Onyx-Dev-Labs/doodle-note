import Link from "next/link";

export default function HelpNotFound() {
  return (
    <main id="help-main" className="help-home help-not-found" tabIndex={-1}>
      <p className="help-eyebrow">A SMALL DETOUR</p>
      <h1>That guide isn’t here.</h1>
      <p>
        The address may have changed. Search the guides above, or head back to
        find your next step.
      </p>
      <Link href="/help" className="help-button">
        Back to Help &amp; guides →
      </Link>
    </main>
  );
}
