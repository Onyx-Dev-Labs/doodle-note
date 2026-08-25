# Making DoodleNote open source

DoodleNote is already licensed as open source. The remaining work is to
**make the GitHub repository public** without changing the product model
you already ship: a free local app, and paid official cloud hosting for
sync.

This document is the launch plan and the policy to keep after launch.
Tracking: [ONY-196](https://linear.app/onyxdevlabs/issue/ONY-196/publish-doodlenote-as-a-public-open-source-repository)
(children [ONY-197](https://linear.app/onyxdevlabs/issue/ONY-197/confirm-mit-vs-server-relicense-before-going-public),
[ONY-199](https://linear.app/onyxdevlabs/issue/ONY-199/harden-ci-and-docs-before-the-public-github-flip),
[ONY-198](https://linear.app/onyxdevlabs/issue/ONY-198/scan-secrets-and-make-the-doodlenote-github-repository-public)).

## What is already true

Confirmed against `Onyx-Dev-Labs/doodle-note` on 2026-08-25:

| Fact | Evidence |
| --- | --- |
| The code is MIT | Root [`LICENSE`](../LICENSE); GitHub reports `license.key = mit` |
| The business model is already coded | [`apps/web/app/pricing/page.tsx`](../apps/web/app/pricing/page.tsx): Free forever + Sync at **$10 / user / month** |
| Billing already exists | [`apps/web/lib/billing.ts`](../apps/web/lib/billing.ts): Stripe, 15-day trial, grandfathering; dormant when `STRIPE_SECRET_KEY` is unset |
| Local capture does not need an account | README and pricing copy; desktop and iPhone store meetings locally |
| Community files already exist | `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates (added in PR #62, `docs: prepare DoodleNote for public contributors`) |
| The repository is still **private** | GitHub `visibility: private`, `allow_forking: false`, 0 stars, 0 public forks |
| GitHub Releases are empty | README links to them; `gh release` list is empty. Consumer downloads live on [doodlenote.ai](https://www.doodlenote.ai) |

You do not need a second “free edition” codebase. The free product is the
desktop and iPhone apps in this repo, running locally. The **$10 Sync
plan stays**. It is the optional official backup and multi-device copy
of notes you already sell; open-sourcing does not remove it.

## Recommended model

**Open-source the whole monorepo under MIT. Keep charging $10 / user /
month for official hosted Sync at doodlenote.ai.** The local app is
free forever. Sync is optional: only people who want a cloud backup,
another device, or the web library pay.

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
support. The source for those features can be public.

Self-hosting falls out of the current design: the web app already
runs locally on PGlite without cloud credentials
([`apps/web/README.md`](../apps/web/README.md)). When Stripe keys are
absent, entitlement checks pass. That is the honest self-host path.
You do not have to make Docker-compose day-one, but you should not
block people who clone and run the web app themselves.

### Why not hide the sync *source* (this is not “drop the $10 plan”)

Keep the paid Sync product. Do not move `apps/web` into a private
repo or a closed “pro” tree.

- The monorepo already contains desktop, iOS, engine, **and** the
  Next.js sync server, billing, and workspaces under one MIT license.
- Customers still pay DoodleNote $10 / user / month for *your* hosted
  backup, storage, and support. That charge is an API entitlement
  (`402` + `needsSubscription`), not a secret codebase.
- Hiding the server would be a large, trust-damaging refactor.
  Contributors would see “the interesting server is closed.”
- Privacy is the product. An inspectable sync server is a feature of
  that pitch, not a liability.
- A well-funded clone of a $10 notes-sync API is unlikely to beat
  **DoodleNote** the brand, signed Mac/Windows builds, and the
  existing user relationship.

### The one decision you must make *before* going public

MIT grants are irrevocable for the code you publish. You cannot later
take the current tree private-in-effect by switching licenses.

Choose one **now**:

| Option | Use when | Cost |
| --- | --- | --- |
| **A. Keep MIT everywhere (recommended)** | You want maximum trust, GitHub stars, and “the app is free and open.” Moat is brand + hosting. | A competitor may host a compatible sync service. Stop them from calling it DoodleNote via trademark, not copyright. |
| B. MIT clients + AGPL (or similar) for `apps/web` | You specifically fear a hosted fork of the sync server. | Must relicense **before** the visibility flip. Weaker “simple OSS” story. |
| C. Source-available server (BSL / personal-use, Joplin-style) | You want to forbid commercial hosting of the server. | Not Open Source Initiative open source. Expect community pushback. |

Closest analog: [Joplin](https://github.com/laurent22/joplin) ships
local notes clients as open source and sells Joplin Cloud. They later
moved clients to AGPL and put Joplin Server under a personal-use
license. DoodleNote does not need that complexity to launch.

**Recommendation: Option A.** Keep the MIT grant you already made.
Protect the name and mascot separately (see Trademark below).

### Decision recorded — 2026-08-25

Sean Inman, on [ONY-197](https://linear.app/onyxdevlabs/issue/ONY-197/confirm-mit-vs-server-relicense-before-going-public):

- **Option A.** MIT for the entire monorepo, including the sync server.
- Official Sync stays **$10 / user / month** at doodlenote.ai as
  optional cloud backup. The local app stays free forever.
- Trademark reserved in [TRADEMARK.md](../TRADEMARK.md). No CLA.

## What you are selling

Say this in public, because the code already says it:

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
pricing page and the open-source promise. The $10 plan remains the
paid cloud backup; it is not removed by going public.

## Trademark is the real lock

Copyright (MIT) lets anyone use the code. Trademark lets you stop
someone shipping a fork as “DoodleNote.”

Before going public:

- Keep using “DoodleNote” as one word ([`docs/BRAND.md`](BRAND.md)).
- Add a short `TRADEMARK.md` (or a License section) that says:
  - MIT covers the software.
  - “DoodleNote,” the wordmark, and the doodle-dog mascot are
    trademarks of Onyx Dev Labs.
  - Forks must rename and replace brand assets unless they have written
    permission.
- Consider a US trademark filing for DoodleNote if it is not already
  filed. This is legal work, not a code change.

Public-client OAuth IDs in the desktop app
(`BUILT_IN_GOOGLE_CLIENT_ID`, `BUILT_IN_MS_CLIENT_ID`) are **not**
secrets. They are intended to ship in the client. Forks should use
their own OAuth apps; document that.

## Launch sequence

Do these in order. The visibility flip is last and is an organization
owner action. It is not a pull request.

### 1. Confirm license and trademark (human)

- Keep MIT, or relicense `apps/web` *before* anyone can clone publicly.
- Decide that official Sync remains $10 / user / month at
  doodlenote.ai.
- Write the trademark sentence into `TRADEMARK.md` or the README.

### 2. Secret and log hygiene (blocker)

Going public publishes **the entire git history** and, per
[GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility),
**Actions history and logs**.

- Run a full-history scan (gitleaks or GitHub secret scanning on the
  private repo first). Rotate anything that ever appeared in git,
  Actions logs, or committed `.env` files. Then scrub history only if
  a live secret was committed; rotating is mandatory either way.
- Current tree: no `.env` files tracked; `.gitignore` already excludes
  them. Desktop Google/Microsoft client IDs are public-client IDs.
- Delete or restrict old workflow runs if logs could contain notary
  output, Stripe, Twilio, or Blob tokens.
- Confirm GitHub Actions secrets stay as secrets
  (`WINDOWS_CSC_LINK`, Apple notary, `BLOB_READ_WRITE_TOKEN`). Fork
  pull requests do not receive repository secrets; keep it that way.

History note: large `.next-agent` cache blobs exist in older commits
(~17 MB). They are not in `HEAD`. Optional cleanup with
`git filter-repo` shrinks clones; it is not required to go public.

### 3. Harden CI for strangers (code)

`.github/workflows/ci.yml` builds a Windows installer on **every**
pull request and uploads it as an artifact. After the repo is public:

- Fork PRs must not produce downloadable installers. Gate
  `windows-package` (and artifact upload) on
  `github.event.pull_request.head.repo.full_name == github.repository`.
- In repo Settings → Actions: require approval for first-time
  contributors.
- iOS uses `macos-26` on path-filtered PRs; keep that path filter.

### 4. Docs that public users will hit immediately

- Add `apps/web/.env.example` listing the optional groups already
  documented in [`apps/web/README.md`](../apps/web/README.md)
  (`.gitignore` already has `!.env.example`, but the file is missing).
- Add a short “Self-hosting Sync” section: clone, `pnpm --filter web
  dev`, PGlite default, what production needs (`DATABASE_URL`,
  `BETTER_AUTH_*`, Blob). Official Stripe billing is doodlenote.ai
  only.
- Point README “GitHub Releases” at reality: either start publishing
  checksummed GitHub Releases, or link downloads to doodlenote.ai so
  the empty Releases page is not the first 404.
- Link this document from the README License section.

### 5. GitHub settings on the flip day

Organization owner, after steps 1–4:

1. Settings → Code security: enable secret scanning, push protection,
   Dependabot alerts, and private vulnerability reporting (SECURITY.md
   already points at the advisory form).
2. Settings → General: disable Wiki (spam surface; `hasWikiEnabled`
   is currently on). Enable Discussions if you want a support forum
   separate from issues.
3. Settings → Actions: “Require approval for first-time contributors.”
4. Protect `main`: required PR, required CI, no force-push.
5. Danger Zone → Change visibility → **Make public**.
   Confirm you understand: anyone can view and fork; Actions logs
   become public; push rulesets are disabled
   ([GitHub docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)).
6. Check the [community profile](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories)
   (`/community`). README, license, CoC, contributing, security, and
   issue templates should already check out.
7. Create the first GitHub Release (even if artifacts stay on
   doodlenote.ai) so the Releases URL in the README is not empty.
8. Announce: README badge already claims MIT; website pricing already
   matches. Add a changelog line and a link from doodlenote.ai to the
   public repo.

Do not transfer the repo out of `Onyx-Dev-Labs` unless you are
creating a dedicated `doodlenote` GitHub org. Either is fine; stay
put for launch.

## What not to do

- Do not rewrite history after the repo is public except for a
  documented secret incident.
- Do not open-source signing certificates, notary keys, Stripe live
  keys, or customer meeting data. They are not in this tree.
- Do not add a CLA unless you expect to relicense. CONTRIBUTING.md
  already states contributions are MIT. A CLA is extra friction.
- Do not hide `apps/web` in a private repo “just in case.” The billing
  gate is an API check, not repository visibility.
- Do not promise GitHub Releases until you publish one.

## Contributor and maintainer load

Public issues will include “it didn’t record Zoom,” feature ideas, and
the occasional security report. You already have templates that force
a privacy checkbox and route vulns to advisories. Keep Linear as the
internal tracker; GitHub Issues as the public inbox. Do not sync
customer meeting content into either.

## Success

DoodleNote is open source when:

- [ ] `https://github.com/Onyx-Dev-Labs/doodle-note` is public and
      cloneable without auth
- [ ] LICENSE remains MIT (or a documented pre-launch relicense)
- [ ] TRADEMARK.md (or equivalent) reserves the name and mascot
- [ ] Free local app still requires no account
- [ ] Official Sync is still $10 / user / month at doodlenote.ai
- [ ] Fork PRs cannot upload Windows installers
- [ ] Secret scanning and private vulnerability reporting are on
- [ ] Website and README both link to the public repository
