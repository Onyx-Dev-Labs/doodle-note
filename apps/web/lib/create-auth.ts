import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";

import { fullSchema, type Db } from "@repo/db";

import { sendWorkspaceInvitationEmail } from "./invitation-email";

/**
 * Obviously-dev-only fallback so local dev works without any env setup.
 * Never rely on this outside of local development.
 */
const DEV_ONLY_SECRET = "dev-only-insecure-better-auth-secret-change-me";

/** Production canonical site; social OAuth callbacks must match this origin. */
const PRODUCTION_ORIGINS = [
  "https://www.doodlenote.ai",
  "https://doodlenote.ai",
];

function resolveBaseURL(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:4040";
}

function trustedOrigins(): string[] {
  const base = resolveBaseURL();
  return [...new Set([base, ...PRODUCTION_ORIGINS, "http://localhost:4040"])];
}

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

const microsoftEnabled = () =>
  Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);

/**
 * Social providers are optional: each is only wired up when its env vars
 * exist, so local dev works with any subset configured.
 */
function socialProviders() {
  return {
    ...(microsoftEnabled()
      ? {
          microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID as string,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET as string,
            // Universal authority: any work, school, or personal account.
            tenantId: "common",
            prompt: "select_account" as const,
          },
        }
      : {}),
    ...(googleEnabled()
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          },
        }
      : {}),
  };
}

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
    baseURL: resolveBaseURL(),
    trustedOrigins: trustedOrigins(),
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: socialProviders(),
    plugins: [
      organization({
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: sendWorkspaceInvitationEmail,
      }),
      // Required for Next.js App Router — sets session cookies on OAuth return.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export { googleEnabled, microsoftEnabled, resolveBaseURL };
