import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import { fullSchema, type Db } from "@repo/db";

/**
 * Obviously-dev-only fallback so local dev works without any env setup.
 * Never rely on this outside of local development.
 */
const DEV_ONLY_SECRET = "dev-only-insecure-better-auth-secret-change-me";

function resolveSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  console.warn(
    "[auth] BETTER_AUTH_SECRET is not set — using an insecure dev-only secret. " +
      "Set BETTER_AUTH_SECRET before deploying.",
  );
  return DEV_ONLY_SECRET;
}

const googleEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/**
 * Builds a Better Auth instance over the given Drizzle database.
 *
 * Split from ./auth (which instantiates the app-wide singleton over getDb())
 * so smoke tests can construct an instance against a throwaway database.
 */
export function createAuth(db: Db) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema: fullSchema }),
    secret: resolveSecret(),
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:4040",
    emailAndPassword: {
      enabled: true,
    },
    // Google sign-in is optional: only wired up when both env vars exist.
    ...(googleEnabled()
      ? {
          socialProviders: {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID as string,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
            },
          },
        }
      : {}),
    plugins: [organization()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export { googleEnabled };
