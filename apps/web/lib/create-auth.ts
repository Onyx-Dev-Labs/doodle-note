import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";

import { fullSchema, type Db } from "@repo/db";

import { sendWorkspaceInvitationEmail } from "./invitation-email";
import { resolveAuthBaseUrl, resolveAuthSecret } from "./runtime-config";

/** Production canonical site; social OAuth callbacks must match this origin. */
const PRODUCTION_ORIGINS = [
  "https://www.doodlenote.ai",
  "https://doodlenote.ai",
];

function trustedOrigins(): string[] {
  const base = resolveAuthBaseUrl();
  return [...new Set([base, ...PRODUCTION_ORIGINS, "http://localhost:4040"])];
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
    secret: resolveAuthSecret(),
    baseURL: resolveAuthBaseUrl(),
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
export {
  googleEnabled,
  microsoftEnabled,
  resolveAuthBaseUrl as resolveBaseURL,
};
