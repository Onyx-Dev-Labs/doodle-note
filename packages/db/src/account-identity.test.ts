import assert from "node:assert/strict";
import test from "node:test";

import {
  googleIdentityFromClaims,
  microsoftIdentityFromClaims,
  verificationDateForStoredToken,
} from "./account-identity";

test("Microsoft identities use the verified tenant issuer and oid", () => {
  assert.deepEqual(
    microsoftIdentityFromClaims({ tid: "tenant-id", oid: "object-id" }),
    {
      issuer: "https://login.microsoftonline.com/tenant-id/v2.0",
      accountId: "object-id",
    },
  );
});

test("Google identities use the canonical issuer and verified subject", () => {
  assert.deepEqual(googleIdentityFromClaims({ sub: "subject-id" }), {
    issuer: "https://accounts.google.com",
    accountId: "subject-id",
  });
});

test("stored token verification uses a time inside the signed window", () => {
  assert.equal(
    verificationDateForStoredToken({ iat: 1_000, exp: 2_000 }).getTime(),
    1_030_000,
  );
});

test("identity migration rejects incomplete claims and validity windows", () => {
  assert.throws(() => microsoftIdentityFromClaims({ tid: "tenant-id" }), /oid/);
  assert.throws(() => googleIdentityFromClaims({}), /sub/);
  assert.throws(
    () => verificationDateForStoredToken({ iat: 2_000, exp: 1_000 }),
    /valid issuance window/,
  );
});
