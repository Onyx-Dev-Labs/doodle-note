import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from "jose";

import { account, eq, getDb } from "../src/index";
import {
  googleIdentityFromClaims,
  microsoftIdentityFromClaims,
  verificationDateForStoredToken,
  type ExternalAccountIdentity,
} from "../src/account-identity";

/**
 * Better Auth 1.7 account-identity backfill.
 *
 * Run without flags first. `--apply` writes only after every account verifies
 * and the complete future identity set is collision-free. The legacy
 * provenance flag is intentionally opt-in for ID tokens whose signing keys
 * have retired: it still requires the stored token's algorithm, audience,
 * issuer, validity window, and old subject to match the existing account row.
 */

const apply = process.argv.includes("--apply");
const allowStoredTokenProvenance = process.argv.includes(
  "--allow-stored-token-provenance",
);
let storedTokenProvenanceFallbacks = 0;
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function verifiedIdentity(
  providerId: string,
  idToken: string | null,
  legacyAccountId: string,
): Promise<ExternalAccountIdentity> {
  if (!idToken) {
    throw new Error(`${providerId} account has no stored ID token`);
  }

  const unverified = decodeJwt(idToken);
  const header = decodeProtectedHeader(idToken);
  const currentDate = verificationDateForStoredToken(unverified);

  function acceptStoredTokenProvenance(
    expectedAudience: string,
    expectedIssuers: string[],
  ): boolean {
    const audience = Array.isArray(unverified.aud)
      ? unverified.aud
      : [unverified.aud];
    return (
      allowStoredTokenProvenance &&
      header.alg === "RS256" &&
      typeof header.kid === "string" &&
      header.kid.length > 0 &&
      audience.includes(expectedAudience) &&
      typeof unverified.iss === "string" &&
      expectedIssuers.includes(unverified.iss) &&
      unverified.sub === legacyAccountId
    );
  }

  function isRetiredSigningKey(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ERR_JWKS_NO_MATCHING_KEY"
    );
  }

  if (providerId === "microsoft") {
    const identity = microsoftIdentityFromClaims(unverified);
    const clientId = requiredEnv("MICROSOFT_CLIENT_ID");
    const tenantAuthority = identity.issuer.replace(/\/v2\.0$/, "");
    const microsoftKeys = createRemoteJWKSet(
      new URL(
        `${tenantAuthority}/discovery/keys?appid=${encodeURIComponent(clientId)}`,
      ),
    );
    try {
      const { payload } = await jwtVerify(idToken, microsoftKeys, {
        audience: clientId,
        issuer: identity.issuer,
        currentDate,
      });
      return microsoftIdentityFromClaims(payload);
    } catch (error) {
      if (
        isRetiredSigningKey(error) &&
        acceptStoredTokenProvenance(clientId, [identity.issuer])
      ) {
        storedTokenProvenanceFallbacks += 1;
        return identity;
      }
      throw new Error(
        `microsoft stored ID token verification failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  if (providerId === "google") {
    const clientId = requiredEnv("GOOGLE_CLIENT_ID");
    try {
      const { payload } = await jwtVerify(idToken, googleKeys, {
        audience: clientId,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        currentDate,
      });
      return googleIdentityFromClaims(payload);
    } catch (error) {
      if (
        isRetiredSigningKey(error) &&
        acceptStoredTokenProvenance(clientId, [
          "https://accounts.google.com",
          "accounts.google.com",
        ])
      ) {
        storedTokenProvenanceFallbacks += 1;
        return googleIdentityFromClaims(unverified);
      }
      throw new Error(
        `google stored ID token verification failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  throw new Error(`Unsupported OAuth provider: ${providerId}`);
}

async function main() {
  const db = getDb();
  const rows = await db
    .select({
      id: account.id,
      accountId: account.accountId,
      providerId: account.providerId,
      userId: account.userId,
      issuer: account.issuer,
      idToken: account.idToken,
    })
    .from(account);

  const planned = await Promise.all(
    rows.map(async (row) => {
      if (row.issuer) {
        return {
          row,
          identity: { issuer: row.issuer, accountId: row.accountId },
        };
      }
      if (row.providerId === "credential") {
        return {
          row,
          identity: { issuer: "local:credential", accountId: row.userId },
        };
      }
      return {
        row,
        identity: await verifiedIdentity(
          row.providerId,
          row.idToken,
          row.accountId,
        ),
      };
    }),
  );

  const owners = new Map<string, string>();
  for (const item of planned) {
    const key = `${item.identity.issuer}\u0000${item.identity.accountId}`;
    const owner = owners.get(key);
    if (owner && owner !== item.row.id) {
      throw new Error("Account identity collision detected; migration stopped");
    }
    owners.set(key, item.row.id);
  }

  const pending = planned.filter(
    (item) =>
      item.row.issuer !== item.identity.issuer ||
      item.row.accountId !== item.identity.accountId,
  );

  if (apply) {
    for (const item of pending) {
      await db
        .update(account)
        .set(item.identity)
        .where(eq(account.id, item.row.id));
    }
  }

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "check",
      accounts: rows.length,
      pending: pending.length,
      collisions: 0,
      storedTokenProvenanceFallbacks,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Identity backfill failed",
  );
  process.exitCode = 1;
});
