export const WEBHOOK_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
];

export function assertExpectedAccount(actualAccountId, expectedAccountId) {
  if (!expectedAccountId) {
    throw new Error("Set STRIPE_ACCOUNT_ID to the exact intended Stripe account");
  }
  if (actualAccountId !== expectedAccountId) {
    throw new Error(
      `Stripe account mismatch: authenticated ${actualAccountId}, expected ${expectedAccountId}`,
    );
  }
}

export function assertMonthlyPrice(price) {
  const valid =
    price?.active === true &&
    price?.currency === "usd" &&
    price?.unit_amount === 1000 &&
    price?.recurring?.interval === "month";
  if (!valid) {
    throw new Error(
      `Existing Price ${price?.id ?? "unknown"} does not match active USD $10/month`,
    );
  }
}

export function webhookUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new Error("invalid");
    }
    return url;
  } catch {
    throw new Error("STRIPE_WEBHOOK_URL must be a valid credential-free HTTPS URL");
  }
}
