# Share a meeting with people (DEV-485)

A workspace member can give specific people read-only access to one meeting by
email from the meeting's **Share** panel (**Share with people**, above the public
link). Recipients find it under **Shared with me** (`/app/shared`) and open it at
`/app/meeting/<id>` in their own signed-in app. The public link (`/share/<token>`)
is a separate, unchanged option.

## Access rules

- Rows live in `meeting_shares` (migration `0017_meeting_shares.sql`), keyed by
  meeting and normalized lowercase email. Sharing never changes
  `meetings.organization_id` and never writes to `meetings`, `notes` or
  `transcript_segments`. Deleting a meeting (including desktop sync DELETE) or
  the sharer's account deletes the rows; deleting the recipient's account only
  clears `recipient_user_id`.
- A signed-in user matches a share by `recipient_user_id`, or, while it is
  unattached, by account email. **When email verification is enabled
  (`resolveAuthEmailEnabled()`, required in production) only a verified email
  matches.** With verification disabled (local development without Resend) any
  account email matches so localhost testing works. The first match attaches the
  row to that user id; from then on it follows the account and another account
  with the same address cannot claim it.
- Recipients can read notes, read the transcript only when that share includes
  it (owner's toggle, default on), use **Copy notes** and **Export .md**. They see
  no folders, tags, workspace, star, move, sharing or public-link controls. All
  mutating meeting routes (`share`, `move`, `tags`, `star`, `recipients`) still use
  `getMeetingAccess` (workspace membership), so recipients and strangers get 404.
- Opening a shared meeting requires the recipient's own entitlement
  (`entitlementFor`). Without it the meeting is still listed, but the page shows
  an upgrade message and no notes or transcript are loaded.
- Owner-facing API results never reveal whether an address has an account. Only
  the notification email differs: existing accounts get "<owner> shared <title>
  with you" with a meeting link; other addresses get a sign-up invitation whose
  link returns to the meeting. Email uses `RESEND_API_KEY` +
  `INVITATION_FROM_EMAIL`, runs after the response, and is logged instead of sent
  when unconfigured.

The service functions in `lib/meeting-recipients.ts` take the database explicitly
and are transport-neutral, so a bearer-token route can reuse them after its own
authorization.

## Desktop (DEV-486)

The desktop **Share…** dialog uses bearer routes authenticated by the device's
sync token (`authenticateEntitledSyncRequest`: 401 bad token, 402 no
subscription). The sharer is the device's user, and the meeting must already be
synced into the device's workspace; otherwise every method returns 404
"Meeting not synced yet — sync it first". Logic lives in
`lib/sync-meeting-share.ts`.

- `/api/sync/share/recipients?meetingId=<uuid>`: GET / POST / DELETE
  (`&recipientId=`), delegating to `handleMeetingRecipientsRequest`, so bodies,
  validation, caps, responses and notification emails match the web route.
- `/api/sync/share`: GET `?meetingId=` reads the public link; POST
  `{ meetingId, enable, includeTranscript?, expiresInDays? }` creates, updates or
  revokes it, and every response returns `{ url, includeTranscript, expiresAt }`.
  `expiresInDays` is validated like the web Share panel (0, 1, 7, 30). Older
  desktop builds send only `{ meetingId, enable }`: a new link then stays
  notes-only and never expires, and an existing link keeps its settings.

The desktop pushes the meeting before adding recipients or creating/updating
the link, and reports an error instead of a link when the push is rejected.

## Local QA

With no `DATABASE_URL`, no Stripe keys and no Resend keys, local development has
email verification off and every account entitled. Sign up two accounts at
`/login` → **Create account**, link a device or push a meeting for the owner, share
it with the other address, then sign in as the recipient.

To test the upgrade gate, start the server with all five `STRIPE_*` variables set
to placeholder values (for example `STRIPE_SECRET_KEY=sk_test_fixture`). Billing
mode becomes `stripe` and entitlement is read from the `subscriptions` table
without calling Stripe: an account with no row is not entitled; a row with
`status='active'` (or `grandfathered=true`) is entitled. PGlite is single-writer,
so change rows with the dev server stopped. Checkout and the billing portal do not
work with placeholder keys.
