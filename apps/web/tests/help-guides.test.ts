import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { helpCategories, helpGuides } from "../content/help-guides";
import { buildHelpSearchIndex, searchHelp } from "../lib/help-search";
import { GET } from "../app/help/search-index/route";
import sitemap from "../app/sitemap";

const index = buildHelpSearchIndex(helpGuides);
const appRoot = path.resolve(import.meta.dirname, "../app");

test("published guides have unique URLs, section anchors, and complete navigation metadata", () => {
  assert.equal(
    new Set(helpGuides.map((guide) => guide.slug)).size,
    helpGuides.length,
  );
  for (const guide of helpGuides) {
    assert.match(guide.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(guide.title && guide.description && guide.platforms);
    assert.ok(helpCategories.some((category) => category === guide.category));
    assert.equal(
      new Set(guide.sections.map((section) => section.id)).size,
      guide.sections.length,
    );
    for (const section of guide.sections) {
      assert.match(section.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(section.title && section.body.trim());
    }
  }
});

test("every related guide and Markdown link resolves to a published guide, anchor, or existing public page", () => {
  for (const guide of helpGuides) {
    for (const slug of guide.related)
      assert.ok(
        helpGuides.some((item) => item.slug === slug),
        `${guide.slug}: unknown related guide ${slug}`,
      );
    for (const section of guide.sections) {
      for (const match of section.body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const url = new URL(match[1], "https://www.doodlenote.ai");
        assert.equal(
          url.origin,
          "https://www.doodlenote.ai",
          "Review new external destinations explicitly",
        );
        if (url.pathname.startsWith("/help/")) {
          const target = helpGuides.find(
            (item) => `/help/${item.slug}` === url.pathname,
          );
          assert.ok(target, `${guide.slug}: broken ${url.pathname}`);
          if (url.hash)
            assert.ok(
              target.sections.some((item) => `#${item.id}` === url.hash),
            );
        } else {
          assert.ok(
            existsSync(path.join(appRoot, url.pathname, "page.tsx")),
            `${guide.slug}: missing ${url.pathname}`,
          );
        }
      }
    }
    if (guide.image)
      assert.ok(
        existsSync(path.resolve(appRoot, "../public", `.${guide.image.src}`)),
      );
  }
});

test("search exposes only the public article text and valid article/section destinations", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), index);
  for (const entry of index) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "category",
      "href",
      "section",
      "text",
      "title",
    ]);
    const url = new URL(entry.href, "https://www.doodlenote.ai");
    const guide = helpGuides.find(
      (item) => `/help/${item.slug}` === url.pathname,
    );
    assert.ok(guide);
    if (url.hash)
      assert.ok(
        guide.sections.some((section) => `#${section.id}` === url.hash),
      );
    assert.doesNotMatch(
      entry.text,
      /\/Users\/|dnag_[A-Za-z0-9]+|sk-[A-Za-z0-9]+|docs\/reviews/,
    );
  }
});

test("body-only queries find precise sections, not just article titles", () => {
  const results = searchHelp(index, "SmartScreen");
  assert.ok(
    results.some((result) => result.href === "/help/install#install-the-app"),
  );
  assert.ok(
    searchHelp(index, "Input Monitoring").some((result) =>
      result.href.startsWith("/help/bark"),
    ),
  );
  assert.ok(
    searchHelp(index, "revoke link").some(
      (result) => result.href === "/help/sharing#revoke-access",
    ),
  );
});

test("search handles empty, no-result, case, whitespace and literal punctuation queries", () => {
  assert.deepEqual(searchHelp(index, "   "), []);
  assert.deepEqual(searchHelp(index, "no-such-article-zzzz"), []);
  assert.deepEqual(searchHelp(index, "  BARK  "), searchHelp(index, "bark"));
  assert.doesNotThrow(() => searchHelp(index, "[.*+?"));
  assert.deepEqual(searchHelp(index, "[.*+?"), []);
});

test("search uses all query terms and ranks title matches ahead of body-only matches", () => {
  const results = searchHelp(index, "Cloud Sync");
  assert.ok(results[0].href.startsWith("/help/sync"));
  for (const result of results) {
    const text =
      `${result.title} ${result.section} ${result.text} ${result.category}`.toLowerCase();
    assert.ok(text.includes("cloud") && text.includes("sync"));
  }
});

test("sitemap includes every public guide exactly once and excludes the search index", () => {
  const urls = sitemap().map((entry) => entry.url);
  assert.equal(
    urls.filter((url) => url === "https://www.doodlenote.ai/help").length,
    1,
  );
  for (const guide of helpGuides)
    assert.equal(
      urls.filter(
        (url) => url === `https://www.doodlenote.ai/help/${guide.slug}`,
      ).length,
      1,
    );
  assert.ok(!urls.some((url) => url.endsWith("/help/search-index")));
});
