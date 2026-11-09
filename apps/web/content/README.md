# Public Help & guides

`help-guides.ts` is the single curated source for `/help`: article content,
navigation, related links, heading anchors, search, and sitemap URLs. Articles
render on the server with the existing `react-markdown` dependency. Search fetches
a static index only when opened. It does not read accounts, meetings, or internal
repository documentation. No new service, database migration, or credentials are
required.

## Editing

Add or edit an entry in `helpGuides`. Use a stable kebab-case `slug`, a title,
description, category from `helpCategories`, platform/access requirements,
related slugs, and sections with stable IDs. Bodies support Markdown. Start with
prerequisites, provide actionable steps, describe the expected result, and include
recovery guidance. Keep UI labels aligned with the released app. Do not advertise
future capabilities as available. If a slug changes, add a permanent redirect;
preserve existing section IDs wherever possible.

Use explicit `/help/<slug>#<section>` links. Add public product images to
`apps/web/public/help`, with descriptive alt text and an honest caption. Do not
publish private recordings, account identifiers, tokens, or customer screenshots.
Current images are the existing public README demo screenshots, not new captures
of a user's library. They are labeled as macOS examples, not version-specific
proof of every instruction.

## Source review for the initial guides

The launch copy was checked against these implementation sources:

- Installation/platforms: root `README.md` and existing download flow.
- Meeting creation, folders and questions: desktop `HomeView.tsx` and `App.tsx`.
- Notes generation and transcripts: desktop `MeetingView.tsx` and public demo images.
- Models, calendar, Sync and local MCP: desktop `ModelsView.tsx` and
  `SettingsCloudAccess.tsx`. Current labels include **Notes model** and **Get more**;
  older README setup paths must not override the current UI.
- Bark: desktop `DictationSettings.tsx` and its shortcut/permission helpers.
- Sharing: web `app/app/meeting/[id]/meeting-actions.tsx`.
- Hosted agents: web `app/app/settings/agents`, desktop `PaidRemoteMcpSetup.tsx`,
  and `packages/doodle-note-mcp/README.md` for the transport distinction.
- Privacy/account: existing public privacy, pricing and account surfaces.

Source review is not a live tutorial walkthrough. Before production publication,
review the copy against the release being documented, especially Cloud Sync
eligibility, third-party clients, platform support, and Settings labels. Do not add
“last verified” dates without actually walking through that flow.

## Validation

Run `pnpm --filter web exec tsx --test tests/help-guides.test.ts`, web lint,
typecheck, tests, and build. The content checks reject duplicate URLs/anchors,
broken related links, missing images, and broken internal Markdown destinations.
Browser-check public routes, true 404 responses, search and section deep links,
empty/error/retry states, Escape/focus restoration, desktop/mobile navigation,
light/dark appearance, and keyboard controls. Preserve auth checks on `/app` and
APIs. Reading a public guide should never create an account/session or mutate
product data.

The desktop sidebar link needs a desktop release to reach installed users; deploy
the public help site before shipping that link. Website/workspace links travel
with the web deployment. No production publication is performed by editing these
files.
