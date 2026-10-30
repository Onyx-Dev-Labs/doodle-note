import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MarketingDownloadButtons,
  MarketingFooter,
  MarketingHeader,
} from "../app/marketing";
import { DownloadForm } from "../app/download/download-form";
import { MARKETING_CONSENT_TEXT } from "../lib/download-consent";

/** Inspect rendered controls, including boolean attributes, rather than source syntax. */
function attributes(html: string, tag: string): Array<Record<string, string>> {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map(
    (match) =>
      Object.fromEntries(
        [...match[1].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map((attribute) => [
          attribute[1],
          (attribute[2] ?? "").replaceAll("&amp;", "&"),
        ]),
      ),
  );
}

function markup(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

test("redesigned download controls route both platforms through the email form", () => {
  const html = markup(React.createElement(MarketingDownloadButtons));
  const links = attributes(html, "a");
  assert.deepEqual(
    links.map(({ href }) => href),
    ["/download?platform=mac", "/download?platform=win"],
    "marketing controls must not link directly to installers or grant-only routes",
  );
  assert.match(html, /Download for macOS/);
  assert.match(html, /Windows/);
  assert.match(html, /beta/i);
});

for (const platform of ["mac", "win"] as const) {
  test(`${platform} download form retains the selected platform and requires email permission`, () => {
    const html = markup(
      React.createElement(DownloadForm, { initialPlatform: platform }),
    );
    const inputs = attributes(html, "input");
    const email = inputs.find(({ name }) => name === "email");
    assert.ok(email);
    assert.equal(email.type, "email");
    assert.equal(email.maxLength, "254");
    assert.ok(Object.hasOwn(email, "required"));

    const consent = inputs.find(({ name }) => name === "marketingConsent");
    assert.ok(consent);
    assert.equal(consent.type, "checkbox");
    assert.ok(Object.hasOwn(consent, "required"));
    assert.ok(
      !Object.hasOwn(consent, "checked"),
      "permission must not be preselected",
    );
    assert.ok(html.includes(MARKETING_CONSENT_TEXT));

    const selected = inputs.filter(
      ({ type, checked }) => type === "radio" && checked !== undefined,
    );
    assert.deepEqual(
      selected.map(({ value }) => value),
      [platform],
    );
    const submit = attributes(html, "button").find(
      ({ type }) => type === "submit",
    );
    assert.ok(submit && Object.hasOwn(submit, "disabled"));
    assert.ok(attributes(html, "a").some(({ href }) => href === "/privacy"));
    assert.ok(
      !attributes(html, "a").some(({ href }) =>
        /\/updates\/|\/download\/(mac|win)/.test(href),
      ),
    );
  });
}

test("redesigned header and footer retain independent Onyx attribution and service navigation", () => {
  for (const Component of [MarketingHeader, MarketingFooter]) {
    const html = markup(React.createElement(Component));
    const links = attributes(html, "a");
    assert.equal(
      links.filter(({ href }) => href === "https://onyxdev.io").length,
      1,
    );
    assert.match(html, /Built by/);
    assert.match(html, /Onyx Dev Labs/);
    assert.ok(links.some(({ href }) => href === "/login"));
    assert.ok(
      links.some(
        ({ href }) => href === "https://github.com/Onyx-Dev-Labs/doodle-note",
      ),
    );

    let depth = 0;
    for (const [tag] of html.matchAll(/<\/?a\b[^>]*>/g)) {
      depth += tag.startsWith("</") ? -1 : 1;
      assert.ok(
        depth <= 1,
        "the builder link must not be nested inside the home link",
      );
    }
    assert.equal(depth, 0);
  }
  const footerLinks = attributes(
    markup(React.createElement(MarketingFooter)),
    "a",
  );
  for (const href of [
    "/pricing",
    "/privacy",
    "/terms",
    "/contact",
    "/changelog",
  ]) {
    assert.ok(
      footerLinks.some((link) => link.href === href),
      `footer retains ${href}`,
    );
  }
});
