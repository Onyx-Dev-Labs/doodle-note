/**
 * Integration smoke test for Better Auth + the organization plugin.
 *
 * Builds the real auth instance (lib/create-auth) against a FRESH in-memory
 * PGlite database (all drizzle migrations applied), then exercises the server
 * API directly — no HTTP server:
 *
 *   sign up -> sign in -> create organization -> list organizations
 *
 * Run with: pnpm --filter web auth-smoke
 */

// Must be set before lib/create-auth is imported (hence the dynamic imports
// in main) so the smoke run doesn't trip the dev-only-secret warning.
process.env.BETTER_AUTH_SECRET ??= "gV3qLZ0e8kXnR5tYwB7uJ2mCa9PdF4hSiK6oQ1rTxE0="; // smoke-only
process.env.BETTER_AUTH_URL ??= "http://localhost:4040";

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
  });
  assert(signUp.user.email === email, `sign-up returned wrong email: ${signUp.user.email}`);

  // 2. Sign in, capturing the session cookie for authenticated calls.
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  assert(signIn.response.user.email === email, "sign-in returned wrong user");
  const cookie = toCookieHeader(signIn.headers);
  assert(cookie.length > 0, "sign-in did not set a session cookie");
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
    `auth smoke OK: signed up + signed in ${email}, created organization "${org.name}" (${org.slug}), list returned exactly 1 — against fresh in-memory PGlite`,
  );

  await close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
