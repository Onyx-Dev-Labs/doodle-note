import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SiteHeader } from "../app/ui";

const uiSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app/ui.tsx"),
  "utf8",
);

test("marketing brand lockup includes Onyx builder attribution", () => {
  assert.match(uiSource, /built by\{" "\}/);
  assert.match(uiSource, /Onyx Dev Labs/);
  assert.match(uiSource, /ONYX_URL = "https:\/\/onyxdev\.io"/);
  assert.match(uiSource, /export function BrandLockup/);
  assert.match(uiSource, /<BrandLockup priority \/>/);
  assert.match(uiSource, /<BrandLockup compact \/>/);
  assert.match(uiSource, /layout\?: "horizontal" \| "stacked"/);
});

test("app and login surfaces use the shared brand lockup", () => {
  const appHeader = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/app/app-header.tsx"),
    "utf8",
  );
  const loginForm = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/login/login-form.tsx"),
    "utf8",
  );

  assert.match(appHeader, /<BrandLockup[\s\S]*href="\/app"/);
  assert.match(loginForm, /layout="stacked"/);
  assert.match(loginForm, /<BrandLockup/);
});

test("GitHub navigation uses the complete mark at a balanced size", () => {
  const logosSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/logos.tsx"),
    "utf8",
  );

  assert.match(logosSource, /GitHubLogo\(\{ className = "h-5 w-5" \}/);
  assert.match(logosSource, /M12 \.297c-6\.63 0-12 5\.373-12 12/);
  assert.doesNotMatch(logosSource, /3\.015\.555-3\.795/);
});

test("brand navigation never nests one link inside another", () => {
  const html = renderToStaticMarkup(React.createElement(SiteHeader));
  let anchorDepth = 0;

  for (const [tag] of html.matchAll(/<\/?a\b[^>]*>/g)) {
    anchorDepth += tag.startsWith("</") ? -1 : 1;
    assert.ok(anchorDepth <= 1, "links must not be nested");
  }
  assert.equal(anchorDepth, 0);
});
