# DoodleNote open source

The repository is **public** as of 2026-08-25:
[`https://github.com/Onyx-Dev-Labs/doodle-note`](https://github.com/Onyx-Dev-Labs/doodle-note).

The product model did not change: a free local app under MIT, and paid
official cloud hosting for Sync at [doodlenote.ai](https://www.doodlenote.ai).

Launch tracking: [ONY-196](https://linear.app/onyxdevlabs/issue/ONY-196/publish-doodlenote-as-a-public-open-source-repository)
(children [ONY-197](https://linear.app/onyxdevlabs/issue/ONY-197/confirm-mit-vs-server-relicense-before-going-public),
[ONY-199](https://linear.app/onyxdevlabs/issue/ONY-199/harden-ci-and-docs-before-the-public-github-flip),
[ONY-198](https://linear.app/onyxdevlabs/issue/ONY-198/scan-secrets-and-make-the-doodlenote-github-repository-public)).

## What is true

Confirmed against `Onyx-Dev-Labs/doodle-note` on 2026-08-25:

| Fact | Evidence |
| --- | --- |
| The repository is public | GitHub `visibility: public`; anonymous `git ls-remote` works |
| The code is MIT | Root [`LICENSE`](../LICENSE); GitHub reports `license.key = mit` |
| The business model is already coded | [`apps/web/app/pricing/page.tsx`](../apps/web/app/pricing/page.tsx): Free forever + Sync at **$10 / user / month** |
| Billing already exists | [`apps/web/lib/billing.ts`](../apps/web/lib/billing.ts): Stripe, 15-day trial, grandfathering; dormant when `STRIPE_SECRET_KEY` is unset |
| Local capture does not need an account | README and pricing copy; desktop and iPhone store meetings locally |
| Community files exist | `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates |
| Signed downloads are not on GitHub Releases | Consumer downloads live on [doodlenote.ai](https://www.doodlenote.ai) |
| Fork PRs cannot upload Windows installers | `windows-package` in `.github/workflows/ci.yml` is gated to this repository |

You do not need a second “free edition” codebase. The free product is the
desktop and iPhone apps in this repo, running locally. The **$10 Sync
plan stays**. It is the optional official backup and multi-device copy
of notes you already sell; open-sourcing does not remove it.

## Model

**The whole monorepo is MIT. Official hosted Sync is $10 / user /
month at doodlenote.ai.** The local app is free forever. Sync is
optional: only people who want a cloud backup, another device, or the
web library pay.

```text
Free (MIT, no account)
  macOS / Windows / iPhone capture, on-device transcription,
  local or BYO AI notes, folders, search, local MCP

Paid ($10 / user / month, official hosting)
  Device linking, two-way sync, web library, share links,
  team workspaces, hosted agent access
```

This is the Cal.com / Ghost / “hosted convenience” pattern, not
open-core with a secret server. The paid product is **operations**:
signed binaries, Neon, Blob storage, OAuth, Stripe, uptime, and
support. The source for those features is public.

Self-hosting falls out of the current design: the web app already
runs locally on PGlite without cloud credentials
([`apps/web/README.md`](../apps/web/README.md)). When Stripe keys are
absent, entitlement checks pass. That is the honest self-host path.
Official Stripe billing is doodlenote.ai only.

### Why the sync source stays public

Keep the paid Sync product. Do not move `apps/web` into a private
repo or a closed “pro” tree.

- The monorepo already contains desktop, iOS, engine, **and** the
  Next.js sync server, billing, and workspaces under one MIT license.
- Customers still pay DoodleNote $10 / user / month for *your* hosted
  backup, storage, and support. That charge is an API entitlement
  (`402` + `needsSubscription`), not a secret codebase.
- Privacy is the product. An inspectable sync server is a feature of
  that pitch, not a liability.
- A well-funded clone of a $10 notes-sync API is unlikely to beat
  **DoodleNote** the brand, signed Mac/Windows builds, and the
  existing user relationship.

### Decision recorded — 2026-08-25

Sean Inman, on [ONY-197](https://linear.app/onyxdevlabs/issue/ONY-197/confirm-mit-vs-server-relicense-before-going-public):

- **Option A.** MIT for the entire monorepo, including the sync server.
- Official Sync stays **$10 / user / month** at doodlenote.ai as
  optional cloud backup. The local app stays free forever.
- Trademark reserved in [TRADEMARK.md](../TRADEMARK.md). No CLA.

MIT grants are irrevocable for the code you publish. Do not try to
take the current tree private-in-effect by switching licenses later.

## What you are selling

1. **The notepad is free, and stays free.** Recording, transcription,
   and note generation run on the user’s machine. No account. No
   meeting caps.
2. **$10 Sync is optional backup and multi-device copy.** People pay
   only if they want DoodleNote to keep a hosted copy of their notes
   (sync, web library, share links, workspaces). Local notes never
   require this.
3. **Canceling Sync does not delete local notes.** Entitlement is
   enforced on device-link and sync routes (`402` +
   `needsSubscription`), not on the local store.

Do not put local transcription, local models, or the Electron/iOS
capture loop behind a paywall later. That would contradict both the
pricing page and the open-source promise.

## Trademark is the real lock

Copyright (MIT) lets anyone use the code. Trademark lets you stop
someone shipping a fork as “DoodleNote.”

- Keep using “DoodleNote” as one word ([`docs/BRAND.md`](BRAND.md)).
- [TRADEMARK.md](../TRADEMARK.md) already says: MIT covers the
  software; “DoodleNote,” the wordmark, and the doodle-dog mascot are
  trademarks of Onyx Dev Labs; forks must rename and replace brand
  assets unless they have written permission.
- Consider a US trademark filing for DoodleNote if it is not already
  filed. This is legal work, not a code change.

Public-client OAuth IDs in the desktop app
(`BUILT_IN_GOOGLE_CLIENT_ID`, `BUILT_IN_MS_CLIENT_ID`) are **not**
secrets. They are intended to ship in the client. Forks should use
their own OAuth apps.

## Remaining owner settings

These are GitHub organization-owner clicks, not pull requests:

1. Settings → Code security: enable secret scanning, push protection,
   Dependabot alerts, and private vulnerability reporting
   (`SECURITY.md` already points at the advisory form).
2. Settings → General: disable Wiki (spam surface; it is still on).
   Enable Discussions only if you want a support forum separate from
   issues.
3. Settings → Actions: “Require approval for first-time contributors.”
4. Protect `main`: required PR, required CI, no force-push.
5. Close or mark superseded the leftover plan-only PR #66. Hardening
   landed in #67.

Do not transfer the repo out of `Onyx-Dev-Labs` unless you are
creating a dedicated `doodlenote` GitHub org.

## What not to do

- Do not rewrite history after the repo is public except for a
  documented secret incident.
- Do not open-source signing certificates, notary keys, Stripe live
  keys, or customer meeting data. They are not in this tree.
- Do not add a CLA unless you expect to relicense. CONTRIBUTING.md
  already states contributions are MIT.
- Do not hide `apps/web` in a private repo “just in case.” The billing
  gate is an API check, not repository visibility.
- Do not promise GitHub Releases until you publish one. Downloads stay
  on doodlenote.ai.

## Contributor and maintainer load

Public issues will include “it didn’t record Zoom,” feature ideas, and
the occasional security report. Templates already force a privacy
checkbox and route vulns to advisories. Keep Linear as the internal
tracker; GitHub Issues as the public inbox. Do not sync customer
meeting content into either.

## Status

- [x] `https://github.com/Onyx-Dev-Labs/doodle-note` is public and
      cloneable without auth
- [x] LICENSE remains MIT
- [x] TRADEMARK.md reserves the name and mascot
- [x] Free local app still requires no account
- [x] Official Sync is still $10 / user / month at doodlenote.ai
- [x] Fork PRs cannot upload Windows installers
- [x] README and the marketing site both link to the public repository
- [ ] Secret scanning and private vulnerability reporting (owner UI)
- [ ] Wiki disabled; first-time-contributor Action approval; `main`
      protection (owner UI)
