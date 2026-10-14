# Sharing a meeting (DEV-485)

Each meeting has ONE **Share** panel (web: `app/app/meeting/[id]/share-panel.tsx`;
the desktop **Share…** dialog mirrors it), Google-Docs style. Every change saves
immediately:

1. **Share "<title>"** header.
2. **Add people**: one or more email addresses (commas, spaces or new lines) and
   **Share**. Invalid, duplicate, self, already-added and over-cap addresses are
   rejected inline and nothing is saved.
3. **Who has access**: first the workspace's built-in access (no Remove) — "You ·
   Owner / Your Personal workspace" or "Everyone in <Team> · N members" — then each
   person added ("Can view", **Remove**).
4. **General access**: **Only people added** (default) or **Anyone with the link**.
   Choosing the link creates it right away and shows it with **Copy link** and a
   small **Link expires** select (Never — the default — 24 hours, 7 days, 30 days;
   the actual expiry date is shown). Switching back revokes it ("Link turned off").
5. **Include transcript**: one setting for everyone — people added and the link.
   Off (the default) means people see the notes only.

Meetings never move between workspaces; sharing only adds read access.

## API

`GET /api/meetings/<id>/share` and every `POST` return the share state:

```json
{
  "ok": true,
  "includeTranscript": false,
  "link": { "url": "https://…/share/<token>", "expiresAt": null },
  "recipients": [{ "id": "…", "email": "rae@example.com", "createdAt": "…" }],
  "workspace": { "name": "Acme", "personal": false, "memberCount": 4 },
  "limits": { "perRequest": 20, "perMeeting": 50 }
}
```

`link` is `null` for "Only people added" (an expired link also reads as off).
`POST /api/meetings/<id>/share` takes any of
`{ "includeTranscript": boolean, "link": "on" | "off", "expiresInDays": 0 | 1 | 7 | 30 }`
and applies them in one UPDATE:

- `link: "on"` keeps a still-active link (same URL) or mints a new token with no
  expiry; an expired URL is never revived. `link: "off"` clears token and expiry.
- `expiresInDays` (0 = never) needs the link on (or `link: "on"` in the same
  request), otherwise 409 `link_off`. It is rejected with `link: "off"`.
- Older clients' `enable: true|false` is read as `link: "on"|"off"` and never
  changes `includeTranscript`.
- Validation errors are 400 with `{ error, code }` (`invalid_body`,
  `invalid_include_transcript`, `invalid_link`, `invalid_expiry`,
  `nothing_to_update`) and change nothing. A meeting the v2 sync engine owns
  (the `sync_guard_legacy` trigger raises) returns 409 `sync_upgrade_required`.

People are added and removed with `/api/meetings/<id>/recipients`: `GET` →
`{ recipients, limits }`, `POST { emails }` → 201 `{ ok, added, recipients, limits }`
(errors `{ error, code, emails? }`), `DELETE ?recipientId=` → `{ ok, recipients, limits }`.
Both routes use `getMeetingAccess` (workspace membership): recipients and
strangers get 404 on every method.

Logic lives in framework-free modules so the desktop bearer routes reuse it:
`lib/meeting-share-state.ts` (state, settings, HTTP handler) and
`lib/meeting-recipients.ts` (people).

## Storage and access rules

- Transcript visibility is `meetings.share_include_transcript` (default false), the
  single source of truth for the public reader (`/share/<token>`) and for people
  added. The link is `meetings.share_token` / `share_expires_at`. Writes touch only
  those columns, as the public-link route always has; they pass the
  `sync_guard_legacy` trigger and never change `organization_id`.
- People live in `meeting_shares` (migration `0017_meeting_shares.sql`), keyed by
  meeting and normalized lowercase email, with no per-person settings. Sharing
  never writes to `notes` or `transcript_segments`. Deleting a meeting (including
  desktop sync DELETE) or the sharer's account deletes the rows; deleting the
  recipient's account only clears `recipient_user_id`.
- A signed-in user matches a share by `recipient_user_id`, or, while it is
  unattached, by account email. **When email verification is enabled
  (`resolveAuthEmailEnabled()`, required in production) only a verified email
  matches.** With verification disabled (local development without Resend) any
  account email matches so localhost testing works. The first match attaches the
  row to that user id; from then on it follows the account and another account
  with the same address cannot claim it.
- People added find the meeting under **Shared with me** (`/app/shared`) and open
  it at `/app/meeting/<id>`. They read the notes, the transcript only while
  Include transcript is on, and can **Copy notes** and **Export .md**. They see no
  folders, tags, workspace, star, move or sharing controls. All mutating meeting
  routes (`share`, `move`, `tags`, `star`, `recipients`) use `getMeetingAccess`,
  so they get 404.
- Owners find meetings with a public link at `/app?shared=1`.
- Opening a shared meeting requires the recipient's own entitlement
  (`entitlementFor`). Without it the meeting is still listed, but the page shows
  an upgrade message and no notes or transcript are loaded.
- Owner-facing API results never reveal whether an address has an account. Only
  the notification email differs: existing accounts get "<owner> shared <title>
  with you" with a meeting link; other addresses get a sign-up invitation whose
  link returns to the meeting. Email uses `RESEND_API_KEY` +
  `INVITATION_FROM_EMAIL`, runs after the response, and is logged instead of sent
  when unconfigured.

## Desktop (DEV-486)

The desktop **Share…** dialog (`apps/desktop/src/renderer/src/ShareDialog.tsx`)
is the same single panel as the web app, over bearer routes authenticated by the
device's sync token (`authenticateEntitledSyncRequest`: 401 bad token, 402 no
subscription, 503 billing not configured). The sharer is the device's user, and
the meeting must already be synced into the device's workspace; otherwise every
method returns 404 "Meeting not synced yet — sync it first". Logic lives in
`lib/sync-meeting-share.ts` and reuses `lib/meeting-share-state.ts` and
`lib/meeting-recipients-http.ts`.

- `/api/sync/share`: `GET ?meetingId=` returns the share state above plus a
  top-level `url` (the link URL or null). `POST { meetingId, includeTranscript?,
  link?, expiresInDays? }` applies a change with the same rules and returns the
  same shape.
- `/api/sync/share/recipients?meetingId=<uuid>`: GET / POST `{ emails }` /
  DELETE `&recipientId=`, exactly like `/api/meetings/<id>/recipients`.
- **Older desktop builds** send `POST /api/sync/share { meetingId, enable }`.
  `enable: true` creates (or keeps) the link and returns `{ url, … }`; a new link
  never expires; it does NOT change Include transcript, which now also governs
  people added. `enable: false` revokes as before.

`SyncService` (main) exposes `shareState`, `addShareRecipients(meetingId, emails)`,
`removeShareRecipient` and `updateShareSettings(meetingId, { includeTranscript?,
link?, expiresInDays? })`. Adding people and every settings change except turning
the link off pushes the meeting first, and reports an error instead of a link when
the push is rejected (e.g. the id lives in another cloud workspace). Not linked
and local-only imports make no request; 401/402/503 map to guidance; the token is
never logged or returned.

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
