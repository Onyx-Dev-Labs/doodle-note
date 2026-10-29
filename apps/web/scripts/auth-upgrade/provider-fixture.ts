import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { origin } from "./fixture-env";

type Provider = "google" | "microsoft";
interface Grant {
  provider: Provider;
  subject: string;
  email: string;
  authorization: URL;
  invalidAudience?: boolean;
  redirectTokenResponse?: boolean;
}

/** Only token/JWKS/photo transport is substituted. SDK state, PKCE request,
 * account lookup remain real. These redirect flows trust the HTTPS token
 * response; this fixture does not claim an independent JWT verification. */
export async function providerFixture() {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const publicKey = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "synthetic-upgrade-key", alg: "RS256", use: "sig" };
  const grants = new Map<string, Grant>();
  let redeemed = 0;
  async function signedToken(grant: Grant) {
    const now = Math.floor(Date.now() / 1000);
    const tid = "11111111-1111-4111-8111-111111111111";
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: publicKey.kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: grant.provider === "microsoft" ? "pairwise-sub-must-not-be-account-id" : grant.subject,
      ...(grant.provider === "microsoft" ? { tid, oid: grant.subject } : {}),
      iss: grant.provider === "google" ? "https://accounts.google.com" : `https://login.microsoftonline.com/${tid}/v2.0`,
      aud: grant.invalidAudience ? "wrong-audience" : `synthetic-${grant.provider}`,
      name: "Synthetic provider user", email: grant.email, email_verified: true,
      nonce: grant.authorization.searchParams.get("nonce") ?? undefined,
      iat: now, exp: now + 3600,
    })).toString("base64url");
    const input = `${header}.${payload}`;
    return input + "." + Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input))).toString("base64url");
  }
  return {
    signedToken,
    grant(code: string, grant: Grant) { grants.set(code, grant); },
    get redeemed() { return redeemed; },
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | undefined> {
      const url = input instanceof Request ? input.url : String(input);
      if (["https://www.googleapis.com/oauth2/v3/certs", "https://login.microsoftonline.com/common/discovery/v2.0/keys"].includes(url)) return Response.json({ keys: [publicKey] });
      if (url === "https://graph.microsoft.com/v1.0/me/photos/48x48/%24value") return new Response(null, { status: 404 });
      if (!["https://oauth2.googleapis.com/token", "https://login.microsoftonline.com/common/oauth2/v2.0/token"].includes(url)) return undefined;
      assert.equal(init?.redirect, "manual", "token endpoint redirects must not be followed");
      const body = new URLSearchParams(String(init?.body));
      const code = body.get("code")!;
      const grant = grants.get(code);
      assert.ok(grant, "Only explicitly registered synthetic authorization codes may be redeemed");
      assert.equal(url, grant.provider === "google" ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token");
      grants.delete(code);
      redeemed++;
      assert.equal(body.get("client_id"), `synthetic-${grant.provider}`);
      assert.equal(body.get("redirect_uri"), `${origin}/api/auth/callback/${grant.provider}`);
      assert.equal(body.get("grant_type"), "authorization_code");
      const challenge = grant.authorization.searchParams.get("code_challenge");
      assert.ok(challenge, "real SDK authorization must use PKCE");
      assert.equal(grant.authorization.searchParams.get("code_challenge_method"), "S256");
      assert.equal(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), challenge);
      if (grant.redirectTokenResponse) return new Response(null, { status: 302, headers: { location: "https://unexpected.invalid/token" } });
      return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", id_token: await signedToken(grant), token_type: "Bearer", expires_in: 3600, scope: "openid email profile" });
    },
  };
}
