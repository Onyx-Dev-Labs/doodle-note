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
