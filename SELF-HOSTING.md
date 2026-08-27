# Self-hosting DoodleNote Sync

The desktop and iPhone apps store meetings locally and do not require this
server. Self-host the web workspace only when you want to operate your own
device sync, web library, sharing, workspace, or hosted agent service.

## Local development

From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter web dev
```

The development server uses PGlite when `DATABASE_URL` is unset and uses a
clearly marked development-only authentication secret. Do not expose that
configuration to the internet.

## Production requirements

A production self-hosted server must set:

```text
NODE_ENV=production
DOODLENOTE_SELF_HOSTED=true
BETTER_AUTH_URL=https://your-doodlenote-host.example
BETTER_AUTH_SECRET=<unique high-entropy secret>
DATABASE_URL=<durable PostgreSQL connection>
```

Generate `BETTER_AUTH_SECRET` with a cryptographically secure password or
secret generator and store it in the hosting provider's secret manager. Do not
commit it to Git.

Apply the Drizzle migrations under `packages/db/drizzle/` before serving
traffic. Configure the optional environment-variable groups documented in
[apps/web/README.md](apps/web/README.md) only for features you operate.

`DOODLENOTE_SELF_HOSTED=true` disables DoodleNote's official Stripe entitlement
gate. Never set it on the official doodlenote.ai deployment. Official hosted
production must provide the complete Stripe secret, price, and webhook group;
an incomplete group fails closed.

## Operational checklist

- Terminate TLS at the application host and use the public HTTPS origin in
  `BETTER_AUTH_URL`.
- Use a dedicated production database role and encrypted backups.
- Keep OAuth, email, Blob, Stripe, and voice credentials in a secret manager.
- Restrict preview deployments that connect to production data.
- Monitor authentication, sync, sharing, billing, and webhook failures.
- Patch dependencies and rerun `pnpm audit --prod --audit-level=low` regularly.
- Test account, workspace, device, and meeting isolation before onboarding
  users.

This repository does not yet provide a supported Docker Compose or one-click
production stack. Operators are responsible for their hosting, backups,
monitoring, data retention, and upgrades.
