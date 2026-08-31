/**
 * Integration smoke test for Better Auth + the organization plugin.
 *
 * Builds the real auth instance (lib/create-auth) against a FRESH in-memory
 * PGlite database (all drizzle migrations applied), then exercises the server
 * API directly — no HTTP server:
 *
 *   sign up -> verify email -> auto sign in -> create organization -> list organizations
 *
 * Run with: pnpm --filter web auth-smoke
 */

// Must be set before lib/create-auth is imported (hence the dynamic imports
// in main) so the smoke run doesn't trip the dev-only-secret warning.
process.env.BETTER_AUTH_SECRET ??= "gV3qLZ0e8kXnR5tYwB7uJ2mCa9PdF4hSiK6oQ1rTxE0="; // smoke-only
process.env.BETTER_AUTH_URL ??= "http://localhost:4040";
process.env.RESEND_API_KEY ??= "re_smoke_only";
process.env.AUTH_FROM_EMAIL ??= "DoodleNote <no-reply@doodlenote.ai>";

let verificationUrl: string | null = null;
let verificationHtml: string | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (input === "https://api.resend.com/emails") {
    const payload = JSON.parse(String(init?.body)) as {
      html?: unknown;
      text?: unknown;
    };
    const match =
      typeof payload.text === "string"
        ? payload.text.match(/https?:\/\/\S+/)
        : null;
    verificationUrl = match?.[0] ?? null;
    verificationHtml =
      typeof payload.html === "string" ? payload.html : null;
    return Response.json({ id: "smoke-email" });
  }
  return realFetch(input, init);
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`auth smoke FAILED: ${message}`);
}

/** Collapse Set-Cookie response headers into a Cookie request header. */
function toCookieHeader(headers: Headers): string {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")?.split(/,(?=[^;,]+?=)/) ?? [];
  return setCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function main(): Promise<void> {
  const { createInMemoryDb } = await import("@repo/db/testing");
  const { createAuth } = await import("../lib/create-auth");

  const { db, close } = await createInMemoryDb();
  const auth = createAuth(db);

  const email = "smoke@example.com";
  const password = "correct-horse-battery";
  const orgName = "Acme Meetings";
  const orgSlug = "acme-meetings";

  // 1. Sign up (email + password).
  const signUp = await auth.api.signUpEmail({
    body: { name: "Smoke Tester", email, password },
    returnHeaders: true,
  });
  assert(
    signUp.response.user.email === email,
    `sign-up returned wrong email: ${signUp.response.user.email}`,
  );
  assert(
    signUp.response.token === null,
    "unverified sign-up unexpectedly created a session",
  );
  assert(
    toCookieHeader(signUp.headers).length === 0,
    "unverified sign-up set a session cookie",
  );
  assert(verificationUrl, "sign-up did not send a verification email");
  assert(verificationHtml, "verification email did not include an HTML body");
  assert(
    verificationHtml.includes("DoodleNote mascot") &&
      verificationHtml.includes("Verify my email") &&
      verificationHtml.includes("Local-first. Cloud only when you opt in."),
    "verification email did not include the branded DoodleNote content",
  );

  // 2. Verify the email. The verification endpoint should create the session.
  const token = new URL(verificationUrl).searchParams.get("token");
  assert(token, "verification email did not include a token");
  const verification = await auth.api.verifyEmail({
    query: { token },
    returnHeaders: true,
  });
  assert(
    verification.response?.status === true,
    "email verification did not succeed",
  );
  const cookie = toCookieHeader(verification.headers);
  assert(cookie.length > 0, "email verification did not auto-sign in the user");
  const authedHeaders = new Headers({ cookie });

  // 3. Create an organization.
  const created = await auth.api.createOrganization({
    body: { name: orgName, slug: orgSlug },
    headers: authedHeaders,
  });
  assert(created, "createOrganization returned nothing");
  assert(created.name === orgName, `created org has wrong name: ${created.name}`);
  assert(created.slug === orgSlug, `created org has wrong slug: ${created.slug}`);

  // 4. List organizations — expect exactly the one we created.
  const organizations = await auth.api.listOrganizations({
    headers: authedHeaders,
  });
  assert(
    organizations.length === 1,
    `expected exactly 1 organization, got ${organizations.length}`,
  );
  const [org] = organizations;
  assert(org, "listOrganizations returned an empty entry");
  assert(org.name === orgName, `listed org has wrong name: ${org.name}`);
  assert(org.slug === orgSlug, `listed org has wrong slug: ${org.slug}`);

  console.log(
    `auth smoke OK: signed up + verified ${email}, auto-signed in, created organization "${org.name}" (${org.slug}), list returned exactly 1 — against fresh in-memory PGlite`,
  );

  await close();
  globalThis.fetch = realFetch;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
