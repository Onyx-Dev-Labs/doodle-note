import type { JWTPayload } from "jose";

export interface ExternalAccountIdentity {
  accountId: string;
  issuer: string;
}

function requiredString(value: unknown, claim: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Verified ID token is missing ${claim}`);
  }
  return value;
}

/**
 * Stored migration tokens may be expired. Verify them at a timestamp inside
 * their original validity window while still checking signature, audience,
 * issuer, and every identity claim.
 */
export function verificationDateForStoredToken(payload: JWTPayload): Date {
  const lower = payload.nbf ?? payload.iat;
  const upper = payload.exp;
  if (
    typeof lower !== "number" ||
    typeof upper !== "number" ||
    !Number.isFinite(lower) ||
    !Number.isFinite(upper) ||
    lower >= upper
  ) {
    throw new Error("Stored ID token has no valid issuance window");
  }
  return new Date((lower + Math.min(30, (upper - lower) / 2)) * 1000);
}

export function microsoftIdentityFromClaims(
  payload: JWTPayload,
): ExternalAccountIdentity {
  const tenantId = requiredString(payload.tid, "tid");
  const objectId = requiredString(payload.oid, "oid");
  return {
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    accountId: objectId,
  };
}

export function googleIdentityFromClaims(
  payload: JWTPayload,
): ExternalAccountIdentity {
  return {
    issuer: "https://accounts.google.com",
    accountId: requiredString(payload.sub, "sub"),
  };
}
