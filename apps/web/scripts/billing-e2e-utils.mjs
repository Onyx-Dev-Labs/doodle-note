import { randomBytes, randomUUID } from "node:crypto";

export function billingTestIdentity() {
  return {
    email: `billing-e2e-${randomUUID()}@example.com`,
    password: `Dn!${randomBytes(24).toString("base64url")}`,
  };
}

export function stripeCheckoutUrl(value) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "checkout.stripe.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function billingBaseUrl(value = "http://localhost:4040") {
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (
      (!localHttp && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new Error("invalid");
    }
    return url.origin;
  } catch {
    throw new Error(
      "BILLING_E2E_BASE_URL must be HTTPS or a credential-free localhost URL",
    );
  }
}
