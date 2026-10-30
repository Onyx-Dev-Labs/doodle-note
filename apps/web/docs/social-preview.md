# Homepage share preview

The public asset is `public/social/doodlenote-home-v1.png`: 1200 × 630 PNG,
133,735 bytes. It reframes the actual homepage's header and hero, including
the mascot, Bricolage Grotesque / Geist / Caveat typography, forest green
palette, existing headline, and fictional sample meeting illustration.
It contains no customer meeting data.

`lib/site-metadata.ts` supplies static Open Graph and Twitter metadata through
the root layout. The homepage adds its canonical URL and `og:url` separately,
so other routes do not inherit the homepage's URL. Routes without a custom
social image inherit this generic brand image, including shared-note links;
sharing permissions, token validation, expiry, and note rendering are unchanged.
The existing title and description are retained.

The image URL is `https://www.doodlenote.ai/social/doodlenote-home-v1.png`,
consistent with the existing sitemap and production-domain redirect. It is
served directly from `public`, without authentication, a database, dynamic
image rendering, or client JavaScript. Deploy the PNG with the metadata.

## Regeneration

From `apps/web`:

```sh
NEXT_DIST_DIR=.next-build pnpm build
node scripts/prepare-social-image.mjs .next-build
```

The script reads the freshly built `server/app/index.html`, embeds its styles,
Latin fonts, and public mascot, then writes `.next-build/homepage-share.html`.
It applies capture-only layout overrides to the original hero. It does not
edit the homepage or query meetings. If the hero structure changes, update
the capture script accordingly.

Render this self-contained HTML at **1200 × 630 CSS pixels**, with device scale
factor 1, after `document.fonts.ready` and all image decoding completes. For
this version, T3's `html_preview` artifact renderer produced the PNG. Save the
returned PNG to the public asset path. Visually inspect the complete frame
and a 400px-wide preview. Confirm the renderer reports loaded fonts/images
and no overflow. Do not use a screenshot of a signed-in page.

Use a new versioned filename and update `site-metadata.ts` when replacing a
released image, because messaging services can cache both HTML and images.
The checked-in PNG needs no rendering service at build or request time.

## Release validation

Before release, build and test the current upstream-integrated revision. Check
that the initial HTML head for `/` includes the absolute OG/Twitter image URL,
1200 × 630 dimensions, PNG type, alt text, and large-image card for ordinary
requests and Twitter, Facebook, and Slack crawler user agents. Confirm that
`/download` retains its own canonical and other routes do not acquire `/` as
their canonical or `og:url`.

Fetch the deployed image without authentication and verify HTTP 200,
`image/png`, 1200 × 630 dimensions, 133,735 bytes, and SHA-256:
`5958bd4a66361446ea6607f65d384b24b710fefa1ac9b52508e042c079da20ee`.
Verify production separately after deployment; a successful build or merge
alone does not establish that the image is live. Messaging services may cache
previous previews, and plain text without a URL cannot request an OG preview.

## Favicons and compact link previews

`app/favicon.ico` packages the existing DoodleNote desktop artwork as
16, 32, 48, and 256 pixel RGBA icons.
The former starter icon was a white triangle and was still being served at
`/favicon.ico`, even though the PNG icon metadata already pointed to the mascot.
Compact link previews could therefore display the wrong brand.

The PNG icon uses the existing 249 × 249 mascot. The 180 × 180 Apple touch
icon is resized from `apps/desktop/resources/icon.png`, exposed at the
conventional `/apple-touch-icon.png` fallback path, and explicitly linked
in the initial HTML. Only encoding and sizes change; the artwork is retained.
Keep these assets consistent when changing the brand artwork. The `.ico`
file convention supplies a content-versioned favicon link automatically.

Verify `/favicon.ico`, `/mascot.png`, and `/apple-touch-icon.png` all return
HTTP 200 with the expected image types and exact checked-in bytes. Confirm
all icon links in the initial HTML reference DoodleNote assets. Existing
Messages previews may retain an older icon; server verification does not
prove that a previously sent message has refreshed its cached preview.
