/**
 * MailCheap decisions for the n8n download-lead sync. These functions run
 * inside n8n Code nodes: scripts/build-download-lead-workflow.mjs embeds their
 * source verbatim, so each one may only call the others listed in
 * WORKFLOW_FUNCTIONS and must not use imports or module state.
 *
 * MailCheap behavior this relies on (its lib/actions/contacts.js):
 * - POST /contacts never changes an existing contact's status unless
 *   resubscribe is true, which is never sent here. A suppressed or
 *   deleted-after-unsubscribe address comes back with its old status.
 * - PATCH /contacts/{id}/details changes only the field keys given.
 * - POST /contacts/tag adds tags and keeps the others.
 */

/** An n8n HTTP Request result (full response, never error, continue on fail) as status, body, error. */
export function readMailcheapResponse(response) {
  if (!response || typeof response !== "object") {
    return { status: null, body: null, error: "no response" };
  }
  if (response.error) {
    const error = response.error;
    const message =
      typeof error === "string" ? error : error.message || error.description || "request failed";
    return { status: null, body: null, error: String(message).slice(0, 300) };
  }
  const status = typeof response.statusCode === "number" ? response.statusCode : null;
  let body = response.body ?? null;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (status === null) return { status: null, body, error: "response had no status" };
  const message = body && body.error && typeof body.error.message === "string" ? body.error.message : null;
  return {
    status,
    body,
    error: status >= 200 && status < 300 ? null : `MailCheap answered ${status}${message ? `: ${message}` : ""}`.slice(0, 300),
  };
}

/** The download details every synced contact should carry, by MailCheap tag and field key. */
export function desiredDownloadDetails(event, config) {
  const tags = [config.sourceTag, `download-${event.platform}`];
  const fields = {};
  if (config.firstDownloadField) fields[config.firstDownloadField] = event.firstRequestedAt.slice(0, 10);
  if (config.platformField) fields[config.platformField] = event.platform;
  return { tags, fields };
}

/**
 * Decides the MailCheap change for one claimed event from the contact lookup.
 * action: create | update | done | skip | retry. done, skip and retry carry
 * the acknowledgement to send back to DoodleNote.
 */
export function planMailcheapChange({ event, lookup, config }) {
  const ack = (result, details) => ({
    action: result === "synced" ? "done" : result === "skipped" ? "skip" : "retry",
    event,
    ack: { eventId: event.eventId, claimToken: event.claimToken, result, ...details },
  });
  if (!event.marketingConsent || event.marketingConsent.granted !== true) {
    return ack("skipped", { outcome: "no_marketing_permission" });
  }

  const found = readMailcheapResponse(lookup);
  if (found.status === null || (found.status !== 200 && found.status !== 404)) {
    return ack("retry", { error: `Contact lookup failed: ${found.error}` });
  }
  const desired = desiredDownloadDetails(event, config);
  const lifecycle = config.lifecycleField;

  if (found.status === 404) {
    const fields = { ...desired.fields };
    if (event.freeDownloadLifecycleEligible === true) fields[lifecycle] = "free_download";
    return {
      action: "create",
      event,
      expected: { fields, tags: desired.tags, previousStatus: null },
      createBody: {
        newsletter: config.newsletter,
        email: event.email,
        source: event.source,
        tags: desired.tags,
        fields,
      },
    };
  }

  const contact = found.body || {};
  if (typeof contact.id !== "string" || String(contact.email).toLowerCase() !== event.email) {
    return ack("retry", { error: "Contact lookup returned a different or malformed contact" });
  }
  const current = contact.fields || {};
  const fields = {};
  for (const [key, value] of Object.entries(desired.fields)) {
    if (current[key] === undefined || current[key] === null || current[key] === "") fields[key] = value;
  }
  // Only a download-only lead whose contact has no lifecycle yet becomes
  // free_download. A trial, customer, or any other stage is never replaced,
  // and stopped contacts (unsubscribed, bounced, complained, dormant) are not
  // put into a sequence.
  const hasLifecycle = current[lifecycle] !== undefined && current[lifecycle] !== null && current[lifecycle] !== "";
  if (
    event.freeDownloadLifecycleEligible === true &&
    !hasLifecycle &&
    (contact.status === "active" || contact.status === "pending")
  ) {
    fields[lifecycle] = "free_download";
  }
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  const missingTags = desired.tags.filter((tag) => !tags.includes(tag));
  if (Object.keys(fields).length === 0 && missingTags.length === 0) {
    return ack("synced", { outcome: "unchanged", mailcheapContactId: contact.id });
  }
  return {
    action: "update",
    event,
    contactId: contact.id,
    expected: { fields, tags: desired.tags, previousStatus: contact.status },
    fieldsBody: { newsletter: config.newsletter, fields },
    tagsBody: { newsletter: config.newsletter, contacts: [contact.id], tags: desired.tags },
  };
}

/**
 * Confirms a create or update from MailCheap's answers and a fresh read of
 * the contact, and returns the acknowledgement for DoodleNote. Nothing is
 * marked synced until the contact is read back with the expected values.
 */
export function checkMailcheapResult({ plan, writes, verify }) {
  const event = plan.event;
  const ack = (result, details) => ({
    ack: { eventId: event.eventId, claimToken: event.claimToken, result, ...details },
  });

  for (const write of writes) {
    const answer = readMailcheapResponse(write);
    if (answer.status !== null && answer.status >= 200 && answer.status < 300) continue;
    const message = answer.body && answer.body.error ? String(answer.body.error.message || "") : "";
    // A create refused for the address itself (a typo domain, spam trap, or an
    // address MailCheap knows can't receive email) never succeeds on retry.
    // Field and tag problems are configuration, so the event waits for a fix.
    if (
      plan.action === "create" &&
      answer.status === 400 &&
      answer.body &&
      answer.body.error &&
      answer.body.error.code === "validation_failed" &&
      !/^(fields|tags|newsletter)\b/.test(message)
    ) {
      return ack("skipped", { outcome: "mailcheap_rejected_address", error: answer.error });
    }
    return ack("retry", { error: `MailCheap write failed: ${answer.error}` });
  }

  const read = readMailcheapResponse(verify);
  if (read.status !== 200 || !read.body || typeof read.body.id !== "string") {
    return ack("retry", { error: `Contact check failed: ${read.error || "contact missing"}` });
  }
  const contact = read.body;
  if (String(contact.email).toLowerCase() !== event.email) {
    return ack("retry", { error: "Contact check returned a different contact" });
  }
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  const missingTag = plan.expected.tags.find((tag) => !tags.includes(tag));
  if (missingTag) return ack("retry", { error: `Contact check: tag ${missingTag} missing` });
  const fields = contact.fields || {};
  const wrong = Object.entries(plan.expected.fields).find(([key, value]) => fields[key] !== value);
  if (wrong) {
    // POST /contacts fills only empty fields on a contact that appeared since
    // the lookup; a value someone else set first is kept and is not a failure.
    const created = readMailcheapResponse(writes[0]);
    const raced = plan.action === "create" && created.body && created.body.created === false;
    if (!raced) return ack("retry", { error: `Contact check: ${wrong[0]} not saved` });
  }

  const lifecycleSet = Object.values(plan.expected.fields).includes("free_download") && !wrong;
  let outcome;
  if (plan.action === "create") {
    const created = readMailcheapResponse(writes[0]).body;
    if (created && created.created === false) outcome = "existing_contact";
    else if (["unsubscribed", "bounced", "complained"].includes(contact.status)) outcome = "created_suppressed";
    else outcome = lifecycleSet ? "created_free_download" : "created_without_lifecycle";
  } else {
    outcome = lifecycleSet ? "updated_free_download" : "updated_download_details";
  }
  return ack("synced", { outcome, mailcheapContactId: contact.id });
}

/** Order matters only for readability in the n8n Code nodes. */
export const WORKFLOW_FUNCTIONS = [
  readMailcheapResponse,
  desiredDownloadDetails,
  planMailcheapChange,
  checkMailcheapResult,
];

export const DEFAULT_CONFIG = {
  doodlenoteBaseUrl: "https://www.doodlenote.ai",
  mailcheapBaseUrl: "https://mailcheap.ai",
  newsletter: "doodlenote",
  lifecycleField: "doodlenote_lifecycle",
  firstDownloadField: "doodlenote_first_download",
  platformField: "doodlenote_download_platform",
  sourceTag: "website-download",
  claimLimit: 25,
};
