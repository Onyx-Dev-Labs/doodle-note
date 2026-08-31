# DoodleNote web workspace

The Next.js application powers the public website and DoodleNote's optional cloud features: authentication, device linking, meeting sync, shared links, team workspaces, billing, and hosted read-only agent access.

Local-first desktop and iPhone capture do not depend on this app. Users opt into cloud features separately.

## Run locally

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter web dev
```

Open [http://localhost:4040](http://localhost:4040).

No external service is required for the basic local development path:

- the database falls back to PGlite under `packages/db/.pglite/` when `DATABASE_URL` is unset in development;
- authentication uses an explicit insecure development fallback when `BETTER_AUTH_SECRET` is unset;
- OAuth, email delivery, billing, and voice features remain disabled until their complete environment-variable groups are present.

## Optional environment variables

| Feature                           | Variables                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Hosted database                   | `DATABASE_URL`                                                                                                                       |
| Auth origin and production secret | `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`                                                                                              |
| Microsoft sign-in                 | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`                                                                                     |
| Google sign-in                    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                                                           |
| Account verification              | `RESEND_API_KEY`, `AUTH_FROM_EMAIL`                                                                                                  |
| Workspace invitations             | `RESEND_API_KEY`, `INVITATION_FROM_EMAIL`                                                                                            |
| Billing                           | `STRIPE_SECRET_KEY`, `STRIPE_ACCOUNT_ID`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION_ID`                |
| Voice features                    | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_CALLER_ID`, `TWILIO_AUTH_TOKEN` |

A commented template is in [`.env.example`](.env.example). Store local
values in a gitignored `.env.local`. Do not commit production
credentials or copy real account/meeting data into tests.

## Self-hosting Sync

The same app can sync devices against a server you run. Local
development already does this with PGlite when `DATABASE_URL` is
unset. Production fails closed without a durable database. For a
self-hosted instance set `DATABASE_URL`, `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`, and
`DOODLENOTE_SELF_HOSTED=true` (and Blob/OAuth if you need those features).

Official **$10 / user / month** Sync billing is the doodlenote.ai
hosted product (Stripe). The explicit self-hosted flag bypasses that
entitlement gate. Official production fails closed when the Stripe
configuration is missing or incomplete. Portal sessions must use a dedicated
DoodleNote Customer Portal configuration instead of the Stripe account default.
This repository does not ship a production Docker Compose stack yet; see
[`SELF-HOSTING.md`](../../SELF-HOSTING.md).

## Stripe test setup

Provisioning requires the expected account ID so a valid key for the wrong
Stripe account fails before it creates anything:

```sh
STRIPE_SECRET_KEY=<test-key> \
STRIPE_ACCOUNT_ID=<expected-account-id> \
node apps/web/scripts/stripe-setup.mjs
```

For a deployed test preview, also set `STRIPE_WEBHOOK_URL` to that preview's
HTTPS `/api/billing/webhook` URL and set `STRIPE_WEBHOOK_SECRET_OUTPUT` to a
new secure local file. The script writes the one-time signing secret with
owner-only permissions and never prints it. Copy the resulting values into
Preview-scoped hosting variables together with an isolated `DATABASE_URL`,
`BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET`. Do not reuse the production
database or production Stripe values for preview QA.

With the preview configured, run the integration check from a trusted local
shell that holds the test Stripe values:

```sh
BILLING_E2E_BASE_URL=https://your-preview.example \
pnpm --filter web exec node scripts/billing-e2e.mjs
```

The check creates an isolated test user and Stripe test subscription, verifies
signed webhook entitlement and device linking, then cancels the subscription
and verifies access is removed. Keep `.env.local` and generated secret files
out of Git.

## Commands

```sh
pnpm --filter web dev
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
pnpm --filter web auth-smoke
pnpm --filter @repo/db test
```

The current Next.js version may differ from older App Router examples. Read `apps/web/AGENTS.md` and the installed framework documentation before changing framework APIs.
