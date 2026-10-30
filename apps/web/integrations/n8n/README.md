# Website download leads → n8n → MailCheap

The website's `/download` form stores each request in Neon (`download_leads`
plus a `download_lead_events` outbox row, written in one statement) before it
releases the installer. n8n then moves consented events into the MailCheap
newsletter `doodlenote`.

```
/download form ──► POST /api/download-leads ──► Neon: lead + pending event ──► grant cookie ──► /download/<platform> ──► installer
                                                       ▲
n8n 15-minute run ──► POST /api/integrations/download-leads/claim (lease)
                  ──► MailCheap: look up, create or fill missing fields, tag, read back
                  ──► POST /api/integrations/download-leads/ack (synced | skipped | retry)
```

- `download-lead-sync.mjs` holds the MailCheap decisions. It is unit-tested and
  end-to-end tested (`tests/download-lead-sync-e2e.test.ts`).
- `download-lead-sync.workflow.json` is generated from it. Rebuild it with
  `node scripts/build-download-lead-workflow.mjs` (plain `node`, not `tsx`).
  A test fails if the JSON is stale.

## Rules the sync keeps

- The form requires the email-permission box before it releases the
  installer, and the endpoint refuses requests without it. The storage layer
  still records a lead without permission as `skipped`, so one could never
  reach MailCheap even if the form changed.
- `doodlenote_lifecycle = free_download` is written only when both are true:
  - No DoodleNote account uses the address. The claim endpoint reports this
    as `freeDownloadLifecycleEligible`.
  - The MailCheap contact is new, or it is `active`/`pending` with no
    lifecycle value yet.

  An existing lifecycle value is never replaced.
- The sync never sends `resubscribe`, never calls the status endpoint, and
  never re-creates a contact. Unsubscribed, bounced, complained, and suppressed
  addresses keep their status.
- Repeat downloads only add a missing platform tag. Existing field values
  (first download date, first platform, lifecycle, sequence progress) are kept.
- An event is acknowledged as `synced` only after MailCheap is read back with
  the expected tags and fields. Outages and configuration errors are acked as
  `retry`, with backoff from 5 minutes up to 6 hours. An unacknowledged claim
  expires after 10 minutes and is claimed again. Each step is idempotent, so a
  replay cannot create a duplicate contact.
- A create that MailCheap refuses for the address itself (typo domain, spam
  trap, undeliverable) is acked as `skipped` / `mailcheap_rejected_address`.

## Launch steps

Do these in order. None of them sends email by itself. The first send happens
when the existing dispatcher acts on a `free_download` contact.

1. **Database.** Apply migrations `0018_download_leads` and
   `0019_download_lead_links` to Neon with
   `pnpm --filter @repo/db exec tsx scripts/migrate.ts` and `DATABASE_URL`
   set. Each is a single idempotent statement. First check that production
   is at 0017, because the tool applies every pending migration.
2. **Secret.** Generate a long random value. Set it as
   `DOWNLOAD_LEADS_SYNC_SECRET` in the production deployment (Vercel), and
   use the same value in n8n:
   - Create a Header Auth credential named `DoodleNote download lead sync`.
   - Header `Authorization`, value `Bearer <secret>`.
3. **MailCheap credential.** In n8n, create or reuse a Header Auth credential
   named `MailCheap API` with `Authorization: Bearer <MailCheap API key>`. The
   key needs full contact access, not a signups-only key.
4. **MailCheap fields.** On the account behind that key, create the two fields
   the sync writes, if they don't exist:
   - `POST /api/v1/contacts/fields` with `{"label":"DoodleNote first download","type":"date"}`
   - `POST /api/v1/contacts/fields` with `{"label":"DoodleNote download platform","type":"text"}`

   Confirm the keys come out as `doodlenote_first_download` and
   `doodlenote_download_platform`. Confirm `doodlenote_lifecycle` already
   exists.
5. **Check the newsletter's signup settings.** Run
   `GET /api/v1/newsletters/doodlenote`. Creating a contact through
   `POST /contacts` triggers MailCheap's own signup emails:
   - If `welcome` is enabled, new contacts get the welcome email.
   - If `requireConfirmation` is on, new contacts get a confirmation email and
     stay `pending` until they confirm.

   MailCheap turns `requireConfirmation` on by default for new newsletters, so
   expect it to be on unless someone changed it. Decide whether that is
   wanted before activating.
6. **Import the sub-workflow.** Import `download-lead-sync.workflow.json`.
   - In `Config`, set `mailcheapBaseUrl` to the MailCheap host that
     `doodlenote` lives on.
   - Select the two credentials on the HTTP nodes.
   - Leave it inactive. It only runs when called or run manually.
7. **Call it from the 15-minute workflow.** Add an *Execute Workflow* node at
   the start of the existing run:
   - Target this sub-workflow, with "Wait for sub-workflow completion" on.
   - Set *On Error* to *Continue*, so a sync failure never stops the
     classifier and dispatcher.

   Running it first means new leads are in MailCheap before classification in
   the same tick.
8. **Verify against the live classifier and dispatcher** (still open; see
   below), then do a manual run with one test download.
9. **Deploy the website.** Deploy last so leads are never dropped. Events
   queue safely in Neon until n8n runs.

## Conversion: how a download lead stops getting free-user emails

The download sync only ever writes `free_download`. Conversion is handled by
the existing n8n automation (confirmed by the owner, 2026-10-29):

- Lifecycle values in `doodlenote_lifecycle`: `free_download`, `trial_active`,
  `paying_customer`.
- n8n sets `paying_customer` from an active Cloud Sync subscription with a
  paid invoice over zero, never from the checkout success page. It checks
  lifecycle every 15 minutes and rechecks Stripe right before each send
  batch, so a conversion ends the free-user enrollment. Emails already queued
  cannot be recalled.
- n8n matches a MailCheap contact to Stripe by **the same normalized email**,
  plus Stripe Customer metadata `doodlenoteUserId` holding the real app user
  ID.

What the website guarantees for that matching:

- Checkout creates the Stripe Customer with the account's email and
  `metadata.doodlenoteUserId` (`ensureCustomer` in `lib/billing.ts`), and every
  Checkout session is bound to that customer, so the billing email is the
  account email. This has been true since billing was added.
- Accounts cannot change their email, so the Stripe email does not drift.
- A later download never overwrites `trial_active` or `paying_customer`
  (covered in `tests/download-lead-sync-e2e.test.ts`).

**Different download and billing emails.** These are linked only when one
person proves both identities:

- The email link `accountLinkUrl`, sent to the download address, proves the
  download address.
- A sign-in at `/download/connect` proves the account.

Confirming creates a verified link and queues a `download_lead_linked` event.
It never sets a lifecycle. n8n reclassifies from Stripe, and the lookup
endpoint exposes the link for later rechecks. Until the person confirms, the
download address keeps `free_download`. The contract (`CONTRACT.md`, section
4) lists the n8n work that remains: putting the link in emails, the linked
event flow, and the lookup in the pre-send recheck.

One more way the email match can break: if the Stripe customer portal lets
customers edit their email, a customer who changes it there no longer
matches. Check that setting in Stripe.

## Still to verify against the live n8n workflows

- What the classifier does with a contact that has no lifecycle value. The
  sync creates account holders this way, because it never writes `free_download`
  for them.
- The dispatcher skips contacts whose MailCheap `status` is not `active`.
- The dispatcher does not key on the tags this sync adds (`website-download`,
  `download-mac`, `download-win`).
- The free-download sequence's emails exist, are approved, and are currently
  off. Leave them off until approved.
