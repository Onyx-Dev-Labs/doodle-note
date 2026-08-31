import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildContactEmail,
  createContactPostHandler,
  type ContactSubmission,
} from "../app/api/contact/route";

const NOW = Date.parse("2026-08-31T18:00:00.000Z");

function validSubmission(
  overrides: Partial<Record<keyof ContactSubmission | "website" | "startedAt", unknown>> = {},
) {
  return {
    name: "  Ada Lovelace  ",
    email: " ADA@example.com ",
    company: " Analytical Engines ",
    phone: " +1 817 555 0100 ",
    message: "  I have a question about DoodleNote Cloud Sync.  ",
    website: "",
    startedAt: NOW - 5_000,
    ...overrides,
  };
}

function request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://www.doodlenote.ai/api/contact", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.doodlenote.ai",
      "x-forwarded-for": "203.0.113.42",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("DoodleNote contact form", () => {
  it("normalizes and sends a valid same-origin submission", async () => {
    const sent: ContactSubmission[] = [];
    const post = createContactPostHandler({
      now: () => NOW,
      allowRequest: () => true,
      sendEmail: async (submission) => {
        sent.push(submission);
      },
    });

    const response = await post(request(validSubmission()));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(sent, [
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: "Analytical Engines",
        phone: "+1 817 555 0100",
        message: "I have a question about DoodleNote Cloud Sync.",
      },
    ]);
  });

  it("rejects cross-origin and invalid submissions without sending", async () => {
    let sends = 0;
    const post = createContactPostHandler({
      now: () => NOW,
      allowRequest: () => true,
      sendEmail: async () => {
        sends += 1;
      },
    });

    const wrongOrigin = await post(
      request(validSubmission(), { origin: "https://example.com" }),
    );
    const invalid = await post(
      request(validSubmission({ email: "not-an-email", message: "short" })),
    );

    assert.equal(wrongOrigin.status, 403);
    assert.equal(invalid.status, 400);
    assert.equal(sends, 0);
  });

  it("quietly acknowledges the honeypot without sending", async () => {
    let sends = 0;
    const post = createContactPostHandler({
      now: () => NOW,
      allowRequest: () => true,
      sendEmail: async () => {
        sends += 1;
      },
    });

    const response = await post(
      request(validSubmission({ website: "https://spam.example" })),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(sends, 0);
  });

  it("rejects automated instant submissions and exhausted rate limits", async () => {
    let sends = 0;
    const tooFast = createContactPostHandler({
      now: () => NOW,
      allowRequest: () => true,
      sendEmail: async () => {
        sends += 1;
      },
    });
    const rateLimited = createContactPostHandler({
      now: () => NOW,
      allowRequest: () => false,
      sendEmail: async () => {
        sends += 1;
      },
    });

    const fastResponse = await tooFast(
      request(validSubmission({ startedAt: NOW - 250 })),
    );
    const limitedResponse = await rateLimited(request(validSubmission()));

    assert.equal(fastResponse.status, 400);
    assert.equal(limitedResponse.status, 429);
    assert.equal(sends, 0);
  });

  it("builds a replyable, escaped email only for the Onyx team inbox", () => {
    const email = buildContactEmail(
      {
        name: "Ada <script>alert(1)</script>",
        email: "ada@example.com",
        company: "Example & Co.",
        phone: "",
        message: "Question <b>with markup</b>",
      },
      "DoodleNote <no-reply@doodlenote.ai>",
    );

    assert.deepEqual(email.to, ["team@onyxdev.io"]);
    assert.equal(email.reply_to, "ada@example.com");
    assert.equal(email.from, "DoodleNote <no-reply@doodlenote.ai>");
    assert.match(email.subject, /^DoodleNote contact from Ada/);
    assert.match(email.text, /Question <b>with markup<\/b>/);
    assert.match(email.html, /Ada &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(email.html, /Question &lt;b&gt;with markup&lt;\/b&gt;/);
    assert.doesNotMatch(email.html, /<script>|<b>with markup<\/b>/);
  });
});
