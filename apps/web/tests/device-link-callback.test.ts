import assert from "node:assert/strict";
import test from "node:test";
import { deviceLinkCallback, validLinkState, linkCredentialScope } from "../lib/device-link-callback";

test("existing desktop callback stays loopback-only and native callback binds one state", () => {
  const content = { token: "synthetic-only", email: "a@example.test", workspaceName: "Work & notes" };
  const old = new URL(deviceLinkCallback({ ...content, port: 54321 }));
  assert.equal(old.origin, "http://127.0.0.1:54321");
  assert.equal(old.pathname, "/callback");
  assert.equal(old.searchParams.get("workspace"), content.workspaceName);
  assert.equal(old.searchParams.has("state"), false);
  const state = "a".repeat(43);
  const native = new URL(deviceLinkCallback({ ...content, port: null, scheme: "doodlenote", state }));
  assert.equal(native.protocol, "doodlenote:");
  assert.equal(native.host, "link");
  assert.equal(native.searchParams.get("state"), state);
  for (const bad of [null, "", "a".repeat(42), "a".repeat(44), "https://other.test/"]) {
    assert.equal(validLinkState(bad), null);
    assert.throws(() => deviceLinkCallback({ ...content, port: null, scheme: "doodlenote", state: bad }));
  }
  assert.throws(() => deviceLinkCallback({ ...content, port: 54321, scheme: "https" }));
  for (const port of [null, 80, 65536, 1234.5]) {
    assert.throws(() => deviceLinkCallback({ ...content, port }));
  }
});

test("lapsed native links receive only identity scope, while desktop keeps subscription requirement", () => {
  const native = { platform: "ios", purpose: "native-library", state: "a".repeat(43), entitled: false };
  assert.equal(linkCredentialScope(native), "identity");
  assert.equal(linkCredentialScope({ ...native, entitled: true }), "sync");
  assert.equal(linkCredentialScope({ ...native, purpose: undefined }), "invalid");
  assert.equal(linkCredentialScope({ ...native, state: undefined }), "invalid");
  assert.equal(linkCredentialScope({ platform: "desktop", entitled: false }), "subscription");
  assert.equal(linkCredentialScope({ platform: "desktop", entitled: true }), "sync");
});
