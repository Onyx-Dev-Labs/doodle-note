# Better Auth 1.7.1 → 1.7.7

This upgrade requires a coordinated web-auth maintenance window and forward
migration **0017_account_provider_key**. It is not a package-only deployment.
No production database or provider was accessed to qualify this patch.

## Data and identity

Better Auth 1.7.3 removed the required account issuer introduced in 1.7.0–1.7.2.
Version 1.7.7 looks up accounts by `(providerId, accountId)` and rejects multiple
matches. Migration 0017 makes the legacy `issuer` column nullable and drops
`account_issuer_accountId_uidx`. It retains all existing column values and rows:
users, account IDs/owners, password hashes, token fields, sessions, organizations,
memberships, invitations and selected organizations. It does not backfill,
merge, delete, map identities by email, or add a replacement unique index.
New SDK account rows normally have null legacy issuer.

Microsoft already used `oid` in the application's 1.7.1 SDK; this upgrade does
not convert subjects. Whether a deployed database completed older identity
migrations is an operator prerequisite, not an assumption this migration repairs.

Do **not** rerun `auth:backfill-identities` for this upgrade. That historical
1.7.0–1.7.2 tool reasons about issuer/account identity, not the current provider/
account key. It now refuses a missing or nullable issuer schema before reading
accounts, contacting providers or writing data. Investigating older incomplete
migrations requires a separately reviewed identity plan; use the preserved old
source only with explicit authorization. Null issuer on new accounts is normal.

## Coordinated cutover

1. Arrange an authorized backup and maintenance window. Stop **all auth writers**
   and all old auth nodes sharing the database, including background account
   linking/provisioning work. Keep them stopped through migration, journal
   verification and cutover of every node. Draining one deployment instance is
   insufficient. Preserve the existing auth secret and public origin.
2. Run this read-only count preflight using the authorized migration connection.
   Log only the returned count, never provider/account/user IDs or tokens:

   ```sql
   SELECT count(*) AS duplicate_provider_account_groups
   FROM (
     SELECT provider_id, account_id FROM account
     GROUP BY provider_id, account_id HAVING count(*) > 1
   ) AS duplicate_keys;
   ```

   A nonzero count blocks acceptance. Keep auth stopped and obtain a separate
   identity-aware resolution plan. Do not delete/merge accounts, infer ownership
   from email, or mark migration 0017 complete manually. The migration repeats
   this guard under a lock, so a stale clean preflight cannot bypass it.
3. With the deployment's explicitly supplied `DATABASE_URL`, the repository's
   existing command is `pnpm --filter @repo/db exec tsx scripts/migrate.ts`.
   That script can otherwise read root `.env.local`; do not invoke it without
   knowing which authorized connection it will use. For a local development
   database, stop the dev server and use `scripts/migrate-pglite.ts` with an
   explicit `PGLITE_DATA_DIR`. Neither command runs automatically at auth startup.
4. Require successful migration and verify the **0017 journal entry**, its hash,
   nullable column, and absent obsolete index before accepting traffic:

   ```sql
   SELECT hash, created_at FROM drizzle.__drizzle_migrations
   WHERE created_at = 1793123877075;
   SELECT is_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'account' AND column_name = 'issuer';
   SELECT count(*) AS obsolete_indexes FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'account_issuer_accountId_uidx';
   ```

   Expect one matching journal row (hash equals SHA256 of the deployed 0017 SQL),
   `YES`, and `0`. A runner error or missing journal entry is not acceptance,
   even if the physical column is already nullable. Keep writers stopped and
   retry the unchanged migration after resolving the operational cause.
5. Deploy exact Better Auth 1.7.7 and its matching schema/config to **all** auth
   nodes. Validate credential login, existing sessions, new signup and both
   configured social providers in the separately authorized environment before
   resuming service. Pending 1.7.1 OAuth sign-ins/account linking cannot complete
   on 1.7.7: restart them. Do not add an old-state fallback. Ordinary email
   verification tokens and database session cookies have separate continuity
   tests; that is not a guarantee for every deployed session or secret history.

## Atomicity and operational limits

The installed Drizzle 0.45.2 Neon HTTP migrator reads `_journal.json`, splits SQL
only at statement-breakpoint markers, executes statements individually, then
inserts journal rows separately. It does **not** wrap the whole migration in a
transaction. PGlite's migrator does use a surrounding transaction.

0017 deliberately contains one unsplit `DO` statement. It sets transaction-local
`lock_timeout = '5s'`, takes `ACCESS EXCLUSIVE` on account, counts duplicate
provider/account groups, and raises a count-only exception before DDL if any
exist. Both DDL operations share the statement's transaction. Failure rolls
back that statement; it leaves old constraints/index and row values intact.
The lock blocks concurrent account reads/writes while held. Five seconds bounds
waiting to acquire locks, **not** the full duplicate scan/execution time: the
connection/database `statement_timeout` governs that separately and may be
unlimited. This patch does not set global timeouts or certify production lock
contention. Operators must choose an appropriate statement timeout/window.

Neon can commit this DDL and then fail to insert the journal entry. `DROP NOT
NULL` and `DROP INDEX IF EXISTS` make that gap safely retryable; the guard runs
again. Successful DDL alone is not a journaled deployment. A lock protects the
statement only: it does not stop old writers after commit. The maintenance-window
requirement remains mandatory. No new permanent uniqueness policy is introduced.

## Rollback limits

Keep the prior deployment and backup, but do not automatically revert to 1.7.1
or restore `NOT NULL`/the old index after new traffic. New null-issuer rows and
the new provider/account lookup are incompatible with that assumption. Stop
writers and review the actual state before any separately authorized rollback;
preserve new users/accounts/sessions and do not invent issuer values, delete
rows, or remap subjects by email. A database restore also needs a reviewed plan
for writes since its snapshot. This patch contains no destructive down migration.

## Qualification and remaining boundaries

The committed synthetic fixture was generated with actual 1.7.1 SDK HTTP signup,
verification, session cookies, organization/invitation APIs and Google/Microsoft
redirect flows against local token responses. Session/state/email-token expiry
is extended only for durable tests. No real identities or credentials are used.
The final tests run actual `createAuth` and 1.7.7 against PGlite, apply the real
migration journal, compare every existing auth-row field before/after DDL, and
exercise old cookies/passwords/email tokens, new signup/verification/login/logout,
organization roles/invitations/active workspace, fresh/repeated provider subjects,
old/mismatched/replayed state and PKCE. Every unmatched outbound fetch is denied,
including auth smoke; Microsoft photo retrieval allows only its exact encoded
fixture URL. The fixture generator refuses to run with a version other than
1.7.1 and is not part of the normal test command.

Separate migration tests use the actual **Neon HTTP Drizzle migrator/driver**
with only its transport redirected into local PGlite, each call autocommitted.
They pin the single-statement loader boundary, duplicate failure, unchanged rows,
DDL-before-journal interruption, retry and journaled no-op behavior. This is not
a live Neon/PostgreSQL contention or remote-deployment test.

The application's built-in Google/Microsoft **redirect** flows trust the pinned
HTTPS token endpoint response. A same-fixture comparison found that both actual
1.7.1 and 1.7.7 accept a wrong-audience synthetic ID token supplied by that
endpoint and issue a session. Both use fixed provider token endpoints with
redirects refused. This inherited trust boundary is recorded explicitly: these
redirect tests do not prove independent JWT signature/audience rejection, and
the observation does not establish that an attacker can control a provider
response or exploit a deployment. No new fallback, provider policy or auth
hardening is added here. Unused direct-ID-token tests are not substituted for
qualification of the application redirect path.

The app retains only organization and Next cookie plugins; Magic Link and OAuth
Proxy are absent. Production-default counters remain **memory-backed**, with
normal 429 behavior checked. The synthetic production probe has no trusted
proxy/IP configuration and exercises the SDK shared per-path fallback bucket;
it does not qualify deployed per-client IP resolution. No database rate limiter
is added. Single-connection
PGlite does not establish the vendor's PostgreSQL concurrent-counter fix.

Run `pnpm --filter web test`, `pnpm --filter @repo/db test`, web typecheck/build,
root lint and a fresh production audit. The existing three DB TS2532 test errors
remain a separately recorded baseline. Native apps, real accounts and release
signing/packaging are not qualified by these software checks.

Vendor reference: [tagged 1.7 upgrade guide](https://github.com/better-auth/better-auth/blob/v1.7.7/docs/content/docs/guides/1-7-upgrade-guide.mdx).
