type RuntimeEnvironment = Record<string, string | undefined>;

const DEV_ONLY_SECRET = "dev-only-insecure-better-auth-secret-change-me";

export type BillingMode =
  | "stripe"
  | "self-hosted"
  | "development"
  | "misconfigured";

/**
 * Local development stays zero-config, but a production server must never
 * start with a public, predictable session-signing secret.
 */
export function resolveAuthSecret(
  env: RuntimeEnvironment = process.env,
): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required in production");
  }
  console.warn(
    "[auth] BETTER_AUTH_SECRET is not set - using an insecure dev-only secret.",
  );
  return DEV_ONLY_SECRET;
}

export function resolveAuthBaseUrl(
  env: RuntimeEnvironment = process.env,
): string {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_URL is required in production");
  }
  return "http://localhost:4040";
}

/**
 * Hosted production requires the complete Stripe configuration. A production
 * deployment may bypass billing only by explicitly declaring itself a
 * self-hosted installation.
 */
export function resolveBillingMode(
  env: RuntimeEnvironment = process.env,
): BillingMode {
  if (env.DOODLENOTE_SELF_HOSTED === "true") return "self-hosted";

  const stripeValues = [
    env.STRIPE_SECRET_KEY,
    env.STRIPE_PRICE_ID,
    env.STRIPE_WEBHOOK_SECRET,
  ];
  if (stripeValues.every(Boolean)) return "stripe";
  if (stripeValues.some(Boolean)) return "misconfigured";
  return env.NODE_ENV === "production" ? "misconfigured" : "development";
}
