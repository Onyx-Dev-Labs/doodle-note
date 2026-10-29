// Synthetic values only. Never inherit auth/provider/database credentials.
export const origin = "http://localhost:4040";
export const secret = "synthetic-upgrade-only-7b1d0689cfe74562ba14e83c90fda215";
export const password = "synthetic-upgrade-password";
export function configureFixture(mode: "test" | "development" | "production" = "development") {
  for (const key of ["DATABASE_URL", "VERCEL_URL", "NEXT_PHASE"]) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: mode, BETTER_AUTH_SECRET: secret, BETTER_AUTH_TELEMETRY: "0",
    BETTER_AUTH_URL: origin, RESEND_API_KEY: "re_synthetic_only",
    AUTH_FROM_EMAIL: "Fixture <fixture@example.test>",
    INVITATION_FROM_EMAIL: "Fixture <fixture@example.test>",
    GOOGLE_CLIENT_ID: "synthetic-google", GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
    MICROSOFT_CLIENT_ID: "synthetic-microsoft", MICROSOFT_CLIENT_SECRET: "synthetic-microsoft-secret",
  });
}
export function cookieHeader(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
