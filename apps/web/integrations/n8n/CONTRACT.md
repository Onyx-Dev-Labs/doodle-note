# Download lead sync: integration contract

For the n8n automation that moves website download leads into MailCheap and
reclassifies linked accounts from Stripe. Every field, limit, and code below
is taken from the implementation on branch `feat/download-email-gate`.
Examples are real responses from that code, run against a throwaway database
with fictitious people. Secrets appear only as `<DOWNLOAD_LEADS_SYNC_SECRET>`,
and link tokens are shortened to `token=v1.…`.

**Status, 2026-10-29: implemented and tested, not deployed.**
- The branch is not merged.
- Migrations 0018 and 0019 are not applied to Neon.
- The sync secret does not exist yet.

Until deployment, every endpoint below returns 404 in production.

## Endpoints

All of them live on the `www` host. Other hosts may redirect, and redirects
drop the `Authorization` header.

| Purpose | Method and URL | Auth |
|---|---|---|
| Claim pending events | `POST https://www.doodlenote.ai/api/integrations/download-leads/claim` | Bearer |
| Acknowledge results | `POST https://www.doodlenote.ai/api/integrations/download-leads/ack` | Bearer |
| Identity lookup | `POST https://www.doodlenote.ai/api/integrations/download-leads/lookup` | Bearer |
| Connect page (people, not n8n) | `GET https://www.doodlenote.ai/download/connect?token=…` | Sign-in session |

## Authentication

n8n endpoints need these headers:

- `Authorization: Bearer <DOWNLOAD_LEADS_SYNC_SECRET>`
- `Content-Type: application/json`

The secret is separate from `CRON_SECRET`, and the comparison is
constant-time.

| Response | Meaning |
|---|---|
| 401 | Wrong or missing bearer |
| 503 | The secret is not set on the server |

In n8n, store it as a Header Auth credential named
`DoodleNote download lead sync`, with name `Authorization` and value
`Bearer <secret>`.

**1Password: not created yet.** The secret hasn't been generated, and the
vaults couldn't be inspected because 1Password was locked. Proposed: an item
named `DoodleNote download lead sync`, with the secret in its `password`
field, in the vault that holds the other DoodleNote production secrets. Use
the same value for Vercel Production (`DOWNLOAD_LEADS_SYNC_SECRET`) and the
n8n credential.

## 1. Claim

Request body: `{"limit": 25, "eventTypes": ["free_download_requested"]}`.

- `limit` is an integer from 1 to 50 and defaults to 25.
- `eventTypes` lists one or more of `free_download_requested` and
  `download_lead_linked`. It defaults to `["free_download_requested"]`, so a
  worker only receives types it asked for. The bundled MailCheap workflow
  claims `free_download_requested`. The Stripe reclassification flow should
  claim `download_lead_linked`.

How retrieval works (a lease queue, with no pages or cursors):

- Each call leases up to `limit` due events, oldest first.
- A lead has at most one leased event at a time, across all types.
- A `download_lead_linked` event waits until the lead's earlier download
  events are synced, so the MailCheap contact exists before reclassification.
- A lease lasts 10 minutes. If it isn't acknowledged by then, the event is
  handed out again with a new `claimToken` and `attempt + 1`.
- To drain the queue, call again after acknowledging, until `events` is `[]`.

| Status | Meaning |
|---|---|
| 200 | `{"events": [...]}`, possibly empty |
| 400 | Bad `limit` or `eventTypes` |

### `free_download_requested` event

```json
{
  "eventId": "77caef32-eb6a-4a16-b9f8-38d29be4ddc5",
  "claimToken": "efad4691-63b8-43d2-b717-95917b701481",
  "eventType": "free_download_requested",
  "attempt": 1,
  "leadId": "c94e20f8-901f-4c10-9b6c-a499f57a34e0",
  "email": "alex@example.com",
  "source": "website_download",
  "platform": "mac",
  "requestedAt": "2026-10-28T15:04:05.000Z",
  "firstRequestedAt": "2026-10-28T15:04:05.000Z",
  "latestRequestedAt": "2026-10-28T15:04:05.000Z",
  "requestCount": 1,
  "marketingConsent": { "granted": true, "grantedAt": "2026-10-28T15:04:05.000Z", "version": "download-marketing-2026-10-29" },
  "account": { "exists": false, "userId": null, "stripeCustomerId": null, "cloudSyncStatus": null },
  "freeDownloadLifecycleEligible": true,
  "accountLinkUrl": "https://www.doodlenote.ai/download/connect?token=v1.…"
}
```

### `download_lead_linked` event

```json
{
  "eventId": "82db9b24-3c2b-48f9-82c4-97b246883ce1",
  "claimToken": "ed0f5e96-1b62-49dc-a183-c0e567906d83",
  "eventType": "download_lead_linked",
  "attempt": 1,
  "leadId": "8ac23290-58a3-4846-97f0-24c4a84c7cb6",
  "email": "jordan.personal@example.com",
  "source": "website_download",
  "firstRequestedAt": "2026-10-28T15:04:05.000Z",
  "latestRequestedAt": "2026-10-28T15:04:05.000Z",
  "requestCount": 1,
  "marketingConsent": { "granted": true, "grantedAt": "2026-10-28T15:04:05.000Z", "version": "download-marketing-2026-10-29" },
  "account": { "exists": false, "userId": null, "stripeCustomerId": null, "cloudSyncStatus": null },
  "link": {
    "userId": "usr_example_123",
    "accountEmail": "jordan@work.example",
    "stripeCustomerId": "cus_Example123",
    "cloudSyncStatus": "active",
    "method": "email_confirmation",
    "verifiedAt": "2026-10-28T16:00:00.000Z"
  }
}
```

A linked event has no `platform`, `requestedAt`,
`freeDownloadLifecycleEligible`, or `accountLinkUrl`.

### Field reference

| Field | Type | Notes |
|---|---|---|
| `eventId` | UUID string | Unique per event. This is the idempotency key. |
| `claimToken` | UUID string | Changes on every lease. Send it back in the ack. |
| `eventType` | `"free_download_requested"` or `"download_lead_linked"` | |
| `attempt` | integer ≥ 1 | 1 on the first delivery. |
| `leadId` | UUID string | Stable, one per normalized download email, forever. |
| `email` | string | The download address, trimmed and lowercased. |
| name | not collected | |
| `source` | `"website_download"` | |
| `platform` | `"mac"` or `"win"` | Download events only. Mac is the current Apple Silicon DMG; Windows is the current beta setup.exe. |
| `requestedAt` | ISO 8601 UTC | Download events only: this event's download request. |
| `firstRequestedAt` / `latestRequestedAt` | ISO 8601 UTC | The lead's first and latest download requests. |
| `requestCount` | integer | All form submissions by this lead. |
| `marketingConsent.granted` | boolean | Always `true`, because the form requires it. Unconsented leads are never handed out. |
| `marketingConsent.grantedAt` | ISO 8601 UTC | When the lead first agreed. |
| `marketingConsent.version` | string | Currently `download-marketing-2026-10-29`. The wording is kept in Neon. |
| `account` | object | The account registered with **this same address**, if any: `exists`, `userId`, `stripeCustomerId`, `cloudSyncStatus`. |
| `link` | object | Linked events only. The verified account for this download address (see section 4). |
| `cloudSyncStatus` | string or null | A Stripe subscription status (`trialing`, `active`, `past_due`, `canceled`, …), `none` (no subscription), or `grandfathered`. |
| `freeDownloadLifecycleEligible` | boolean | Download events only. `true` when no account uses this address. |
| `accountLinkUrl` | URL string | Download events only. A signed link proving receipt of mail at this address, valid 180 days from when it was issued (see section 4). |

`account`, `link`, and `cloudSyncStatus` are read when the event is claimed.
They identify people; they do not prove payment. Classify `trial_active` and
`paying_customer` from Stripe only.

## 2. Acknowledge

Send this only after the work is confirmed: a MailCheap read-back for
download events, or Stripe reclassification for linked events.

```json
{ "results": [
  { "eventId": "77caef32-…", "claimToken": "efad4691-…", "result": "synced", "outcome": "created_free_download", "mailcheapContactId": "mc_example_abc" },
  { "eventId": "000880c2-…", "claimToken": "243beacf-…", "result": "retry", "error": "MailCheap 503 service_unavailable" }
]}
```

Response: `{"acknowledged": [...eventIds], "stale": [...eventIds]}`.

Rules for each result:

- The body lists 1 to 50 results.
- `eventId` and `claimToken` must come from the same claim response.
- `result` is one of:
  - `synced`: final. Requires `outcome`.
  - `skipped`: final. Requires `outcome`.
  - `retry`: not final. Requires `error`.
- `outcome` matches `^[a-z_]{1,64}$`. Pick your own codes for linked events,
  for example `reclassified_paying_customer` or `reclassified_no_change`.
- `mailcheapContactId` is optional, at most 64 characters.
- `error` is truncated to 500 characters.
- If any item is invalid, the whole request gets a 400 and nothing is applied.
- `stale` lists items whose token is no longer current, because the lease was
  re-claimed or the event was already acknowledged. They change nothing.
  Treat them as done.

The bundled workflow sends these outcome codes:

- With `synced`:
  - `created_free_download`
  - `created_without_lifecycle`
  - `created_suppressed`
  - `existing_contact`
  - `updated_free_download`
  - `updated_download_details`
  - `unchanged`
- With `skipped`:
  - `mailcheap_rejected_address`
  - `no_marketing_permission`

### Retries

- A `retry` ack sets the next attempt to now + min(6 h, 5 min × 2^(attempt−1)).
  That gives 5, 10, 20, 40, 80, 160 and 320 minutes, then every 6 hours.
- There is no attempt cap. Nothing is dropped, and the last error is kept in
  Neon.
- An unacknowledged lease expires after 10 minutes, and the event is claimed
  again without backoff.

### Duplicates

- One lead exists per normalized email. Repeat downloads update `latest*`
  and `requestCount` and never reset the first-request or consent fields.
- A new download event is created only for a new (lead, platform, UTC day).
- A lead gets one linked event per account it is linked to. Since a lead can
  link to only one account, that means at most one linked event.
- The same event can be delivered more than once after a lease expires, so
  each handler must be safe to repeat. Acks are fenced by `claimToken`.

## 3. Lookup

`POST /api/integrations/download-leads/lookup` with
`{"emails": ["jordan.personal@example.com", "jordan@work.example"]}`.

- The body lists 1 to 100 addresses.
- The lookup is read-only. Use it for the recheck before each send, and to
  find links for leads that were acknowledged long ago.
- Results come back in request order, one per address.
- An invalid address returns `valid: false` with empty fields.

```json
{ "results": [
  {
    "email": "jordan.personal@example.com",
    "valid": true,
    "lead": {
      "leadId": "8ac23290-58a3-4846-97f0-24c4a84c7cb6",
      "firstRequestedAt": "2026-10-28T15:04:05.000Z",
      "latestRequestedAt": "2026-10-28T15:04:05.000Z",
      "requestCount": 1,
      "marketingConsent": { "granted": true, "grantedAt": "2026-10-28T15:04:05.000Z", "version": "download-marketing-2026-10-29" },
      "accountLinkUrl": "https://www.doodlenote.ai/download/connect?token=v1.…",
      "link": {
        "userId": "usr_example_123", "accountEmail": "jordan@work.example", "stripeCustomerId": "cus_Example123",
        "cloudSyncStatus": "active", "method": "email_confirmation", "verifiedAt": "2026-10-28T16:00:00.000Z"
      }
    },
    "account": { "exists": false, "userId": null, "stripeCustomerId": null, "cloudSyncStatus": null },
    "linkedDownloadEmails": []
  },
  {
    "email": "jordan@work.example",
    "valid": true,
    "lead": null,
    "account": { "exists": true, "userId": "usr_example_123", "stripeCustomerId": "cus_Example123", "cloudSyncStatus": "active" },
    "linkedDownloadEmails": [
      { "leadId": "8ac23290-58a3-4846-97f0-24c4a84c7cb6", "email": "jordan.personal@example.com", "verifiedAt": "2026-10-28T16:00:00.000Z" }
    ]
  }
]}
```

What each part of a result means:

- `lead`: the address's download lead. `lead.link` is its verified account
  link.
- `account`: the account registered with the address itself.
- `linkedDownloadEmails`: the other way round. These are the download
  addresses verified as belonging to the account registered with this
  address.

A fresh `accountLinkUrl` is minted on every call, valid for 180 days.

## 4. Identity linking

### Implemented

- **Same address.** A download address that equals an account's address is
  matched automatically, and reported in `account`. Nothing needs confirming.
- **Different address: both identities are verified.** Only the following
  flow creates a link:
  1. n8n puts `accountLinkUrl` in a DoodleNote email sent to the download
     address. The URL carries a token signed for that lead and that exact
     address, and it expires after 180 days. Possessing it proves the person
     received mail there.
  2. The person opens `/download/connect?token=…`. If they aren't signed in,
     they are sent to sign in first, then returned. The session proves the
     account.
  3. The page shows both addresses. The person presses **Connect this
     email**, which posts to `/api/download-leads/connect`. That endpoint
     requires the session, the site's own origin, and a valid token. The
     confirm step exists so mail scanners that open links can't create a
     link.
  4. The website records the link (method `email_confirmation`,
     `verifiedAt`). In the same database statement, it queues one
     `download_lead_linked` event.
- **Refused:**
  - A session alone, with no token, links nothing.
  - A token for another address, a forged token, or an expired token links
    nothing.
  - A lead already linked to another account stays linked to it: the first
    link wins.
  - An address that is registered to a different account can't be linked to
    someone else. The owner of that account signs in with it instead.
- **Linking never sets a lifecycle or marks anyone paid.** It records
  identity only. n8n reclassifies from Stripe.
- **Stripe Customer metadata: confirmed.** `ensureCustomer` in
  `lib/billing.ts` creates the Customer with the account email and
  `metadata.doodlenoteUserId` set to the real user ID. Checkout sessions are
  bound to that Customer. This has been true since billing was added (commit
  a5a1338, 2026-07-07). `link.userId` and `account.userId` equal that
  metadata value.
- **Link pages leak nothing.** They send no referrer and are excluded from
  search engines.

### Still to build on the n8n side

1. Put `accountLinkUrl` in free-download emails, only those sent to that
   lead's address. Treat the URL as a credential for that inbox: don't log it
   and don't put it in other contacts' emails. Get a fresh one from the
   lookup at send time, or store the claim-time URL in a MailCheap text field,
   for example `doodlenote_account_link_url`. A stored URL expires 180 days
   after it was issued.
2. Add a flow that claims `download_lead_linked` events, runs the existing
   Stripe classification for `link.stripeCustomerId` / `link.userId`, and
   sets `doodlenote_lifecycle` on the **download address's** MailCheap
   contact only from Stripe's verdict:
   - `paying_customer`: an active Cloud Sync subscription and a paid invoice
     over 0.
   - `trial_active`: a trialing subscription.
   - Otherwise, leave the lifecycle unchanged.

   Then ack `synced` with your outcome code. If Stripe or MailCheap fails,
   ack `retry`.
3. In the pre-send recheck, call the lookup for the recipient address and
   honor `lead.link` the same way, so a link made after the original event
   still takes effect.
4. The identity-mapping enhancement: match a MailCheap contact to Stripe by
   the same normalized email **or** by `lead.link.stripeCustomerId`.

### Not built and not planned

- Linking from a signed-in download alone. This was rejected: a session must
  not link an arbitrary typed address.
- Unlinking, or moving a link to another account. Today that takes a manual
  database change.

## 5. MailCheap rules the bundled workflow keeps

- It writes `doodlenote_lifecycle = free_download` only when the event's
  `freeDownloadLifecycleEligible` is true **and** the MailCheap contact is
  new, or is `active`/`pending` with no lifecycle value. It never replaces an
  existing value.
- It never sends `resubscribe` and never changes contact status. Unsubscribed,
  bounced, complained, and suppressed addresses keep their state.
- It fills only missing fields and adds only missing tags.
- It reads the contact back before acking `synced`.

## Remaining blockers

1. Commit, review, merge, and deploy `feat/download-email-gate`. This needs
   owner approval.
2. Apply migrations `0018_download_leads` and `0019_download_lead_links` to
   Neon. This needs owner approval.
3. Generate `DOWNLOAD_LEADS_SYNC_SECRET` and store it in 1Password, Vercel
   Production, and the n8n credential.
4. In MailCheap:
   - Create the fields `doodlenote_first_download` (date) and
     `doodlenote_download_platform` (text).
   - Optionally create `doodlenote_account_link_url` (text).
   - Confirm `doodlenote_lifecycle` exists.
   - Check the `doodlenote` newsletter's `requireConfirmation` and `welcome`
     settings.
5. Set the MailCheap API host in the workflow's `Config` node.
6. Check whether the Stripe customer portal lets customers edit their email.
7. Build the n8n items under section 4, "Still to build on the n8n side".
8. Confirm in the live workflows:
   - How a contact with no lifecycle value is classified.
   - That only `active` contacts are emailed.
   - That nothing keys on the tags `website-download`, `download-mac`, or
     `download-win`.

## Files

| Area | Path in the repository |
|---|---|
| Claim, ack, and lookup endpoints | `apps/web/app/api/integrations/download-leads/{claim,ack,lookup}/route.ts` |
| Queue, claim, ack, lookup, and auth logic | `apps/web/lib/download-leads.ts` |
| Link token and linking | `apps/web/lib/download-lead-link.ts` |
| Connect page and confirm endpoint | `apps/web/app/download/connect/page.tsx`, `apps/web/app/download/connect/connect-form.tsx`, `apps/web/app/api/download-leads/connect/route.ts` |
| Download form endpoint | `apps/web/app/api/download-leads/route.ts` |
| Consent wording and version | `apps/web/lib/download-consent.ts` |
| Tables | `packages/db/src/schema.ts`, `packages/db/drizzle/0018_download_leads.sql`, `packages/db/drizzle/0019_download_lead_links.sql` |
| MailCheap decision logic | `apps/web/integrations/n8n/download-lead-sync.mjs` |
| Importable sub-workflow | `apps/web/integrations/n8n/download-lead-sync.workflow.json` |
| Setup steps | `apps/web/integrations/n8n/README.md` |
| Stripe Customer and metadata | `apps/web/lib/billing.ts` (`ensureCustomer`), `apps/web/app/api/billing/checkout/route.ts` |
| Tests | `apps/web/tests/download-leads.test.ts`, `apps/web/tests/download-lead-link.test.ts`, `apps/web/tests/download-lead-sync-e2e.test.ts` |
