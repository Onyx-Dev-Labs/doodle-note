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

- the database falls back to PGlite under `packages/db/.pglite/` when `DATABASE_URL` is unset;
- authentication uses an explicit insecure development fallback when `BETTER_AUTH_SECRET` is unset;
- OAuth, email delivery, billing, and voice features remain disabled until their complete environment-variable groups are present.

## Optional environment variables

| Feature                           | Variables                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Hosted database                   | `DATABASE_URL`                                                                                                                       |
| Auth origin and production secret | `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`                                                                                              |
| Microsoft sign-in                 | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`                                                                                     |
| Google sign-in                    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                                                           |
| Workspace invitations             | `RESEND_API_KEY`, `INVITATION_FROM_EMAIL`                                                                                            |
| Billing                           | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`                                                                      |
| Voice features                    | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_CALLER_ID`, `TWILIO_AUTH_TOKEN` |

A commented template is in [`.env.example`](.env.example). Store local
values in a gitignored `.env.local`. Do not commit production
credentials or copy real account/meeting data into tests.

## Self-hosting Sync

The same app can sync devices against a server you run. Local
development already does this with PGlite when `DATABASE_URL` is
unset. For a durable self-hosted instance you typically set
`DATABASE_URL` and `BETTER_AUTH_SECRET` (and Blob/OAuth if you need
those features).

Official **$10 / user / month** Sync billing is the doodlenote.ai
hosted product (Stripe). When Stripe keys are absent, entitlement
checks pass so a self-hosted copy does not require DoodleNote's paid
plan. This repository does not ship a production Docker Compose stack
yet.

## Commands

```sh
pnpm --filter web dev
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
pnpm --filter web auth-smoke
```

The current Next.js version may differ from older App Router examples. Read `apps/web/AGENTS.md` and the installed framework documentation before changing framework APIs.
