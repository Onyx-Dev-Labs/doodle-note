/**
 * Builds integrations/n8n/download-lead-sync.workflow.json from the tested
 * functions in integrations/n8n/download-lead-sync.mjs. Run after changing
 * either file:
 *
 *   node scripts/build-download-lead-workflow.mjs
 *
 * Run it with plain node: a TypeScript loader such as tsx rewrites function
 * source, which would change the embedded Code nodes.
 *
 * The workflow holds no credentials: its HTTP nodes name two Header Auth
 * credentials that are selected in n8n after import.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_CONFIG, WORKFLOW_FUNCTIONS } from "../integrations/n8n/download-lead-sync.mjs";

const OUTPUT = fileURLToPath(
  new URL("../integrations/n8n/download-lead-sync.workflow.json", import.meta.url),
);

const DOODLENOTE_CREDENTIAL = { httpHeaderAuth: { id: "", name: "DoodleNote download lead sync" } };
const MAILCHEAP_CREDENTIAL = { httpHeaderAuth: { id: "", name: "MailCheap API" } };
const SHARED = WORKFLOW_FUNCTIONS.map((fn) => fn.toString()).join("\n\n");
const CONFIG = "$('Config').first().json";
const PLAN = "$('Plan MailCheap change').item.json";

function code(name, position, jsCode, mode) {
  return {
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    parameters: { ...(mode && { mode }), jsCode },
  };
}

function http(name, position, { method = "GET", url, body, credentials }) {
  return {
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    onError: "continueRegularOutput",
    credentials,
    parameters: {
      method,
      url,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      ...(body && { sendBody: true, specifyBody: "json", jsonBody: body }),
      options: {
        timeout: 20000,
        response: { response: { fullResponse: true, neverError: true } },
      },
    },
  };
}

function route(output, action) {
  return {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [
        {
          id: `route-${action}`,
          leftValue: "={{ $json.action }}",
          rightValue: action,
          operator: { type: "string", operation: "equals" },
        },
      ],
      combinator: "and",
    },
    renameOutput: true,
    outputKey: output,
  };
}

const contactUrl = (email) =>
  `={{ ${CONFIG}.mailcheapBaseUrl }}/api/v1/contacts/{{ encodeURIComponent(${email}) }}?newsletter={{ encodeURIComponent(${CONFIG}.newsletter) }}`;

const nodes = [
  {
    name: "When called by the 15-minute run",
    type: "n8n-nodes-base.executeWorkflowTrigger",
    typeVersion: 1.1,
    position: [0, 0],
    parameters: { inputSource: "passthrough" },
  },
  {
    name: "Run manually",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [0, 200],
    parameters: {},
  },
  code(
    "Config",
    [220, 100],
    `// Site, MailCheap host, newsletter slug, and field keys. No secrets here:\n// both HTTP credentials are n8n Header Auth credentials.\nreturn [{ json: ${JSON.stringify(DEFAULT_CONFIG, null, 2)} }];`,
  ),
  http("Claim download events", [440, 100], {
    method: "POST",
    url: `={{ $json.doodlenoteBaseUrl }}/api/integrations/download-leads/claim`,
    // Only the type this workflow handles; download_lead_linked events go to
    // the Stripe reclassification flow, which claims them itself.
    body: `={{ JSON.stringify({ limit: $json.claimLimit, eventTypes: ["free_download_requested"] }) }}`,
    credentials: DOODLENOTE_CREDENTIAL,
  }),
  code(
    "Split events",
    [660, 100],
    `${SHARED}\n\nconst claim = readMailcheapResponse($input.first().json);\nif (claim.status !== 200) {\n  // Fails this sub-workflow without touching any event; leases expire and the\n  // next run claims them again. The caller continues on error.\n  throw new Error(\`Claiming download events failed: \${claim.error || claim.status}\`);\n}\nconst events = Array.isArray(claim.body && claim.body.events) ? claim.body.events : [];\nreturn events.map((event) => ({ json: event }));`,
  ),
  http("Find MailCheap contact", [880, 100], {
    url: contactUrl("$json.email"),
    credentials: MAILCHEAP_CREDENTIAL,
  }),
  code(
    "Plan MailCheap change",
    [1100, 100],
    `${SHARED}\n\nreturn { json: planMailcheapChange({\n  event: $('Split events').item.json,\n  lookup: $json,\n  config: ${CONFIG},\n}) };`,
    "runOnceForEachItem",
  ),
  {
    name: "Route by plan",
    type: "n8n-nodes-base.switch",
    typeVersion: 3.2,
    position: [1320, 100],
    parameters: {
      rules: { values: [route("create", "create"), route("update", "update")] },
      options: { fallbackOutput: "extra", renameFallbackOutput: "finished" },
    },
  },
  http("Create MailCheap contact", [1540, -100], {
    method: "POST",
    url: `={{ ${CONFIG}.mailcheapBaseUrl }}/api/v1/contacts`,
    body: "={{ JSON.stringify($json.createBody) }}",
    credentials: MAILCHEAP_CREDENTIAL,
  }),
  http("Verify created contact", [1760, -100], {
    url: contactUrl(`${PLAN}.event.email`),
    credentials: MAILCHEAP_CREDENTIAL,
  }),
  code(
    "Check created contact",
    [1980, -100],
    `${SHARED}\n\nreturn { json: checkMailcheapResult({\n  plan: ${PLAN},\n  writes: [$('Create MailCheap contact').item.json],\n  verify: $json,\n}) };`,
    "runOnceForEachItem",
  ),
  http("Update MailCheap fields", [1540, 100], {
    method: "PATCH",
    url: `={{ ${CONFIG}.mailcheapBaseUrl }}/api/v1/contacts/{{ $json.contactId }}/details`,
    body: "={{ JSON.stringify($json.fieldsBody) }}",
    credentials: MAILCHEAP_CREDENTIAL,
  }),
  http("Tag MailCheap contact", [1760, 100], {
    method: "POST",
    url: `={{ ${CONFIG}.mailcheapBaseUrl }}/api/v1/contacts/tag`,
    body: `={{ JSON.stringify(${PLAN}.tagsBody) }}`,
    credentials: MAILCHEAP_CREDENTIAL,
  }),
  http("Verify updated contact", [1980, 100], {
    url: contactUrl(`${PLAN}.event.email`),
    credentials: MAILCHEAP_CREDENTIAL,
  }),
  code(
    "Check updated contact",
    [2200, 100],
    `${SHARED}\n\nreturn { json: checkMailcheapResult({\n  plan: ${PLAN},\n  writes: [$('Update MailCheap fields').item.json, $('Tag MailCheap contact').item.json],\n  verify: $json,\n}) };`,
    "runOnceForEachItem",
  ),
  http("Report result to DoodleNote", [2420, 100], {
    method: "POST",
    url: `={{ ${CONFIG}.doodlenoteBaseUrl }}/api/integrations/download-leads/ack`,
    body: "={{ JSON.stringify({ results: [$json.ack] }) }}",
    credentials: DOODLENOTE_CREDENTIAL,
  }),
];

const next = (...names) => ({ main: names.map((list) => list.map((node) => ({ node, type: "main", index: 0 }))) });

const workflow = {
  name: "DoodleNote · Sync website download leads to MailCheap",
  nodes: nodes.map((node, index) => ({ id: `download-lead-sync-${index + 1}`, ...node })),
  connections: {
    "When called by the 15-minute run": next(["Config"]),
    "Run manually": next(["Config"]),
    Config: next(["Claim download events"]),
    "Claim download events": next(["Split events"]),
    "Split events": next(["Find MailCheap contact"]),
    "Find MailCheap contact": next(["Plan MailCheap change"]),
    "Plan MailCheap change": next(["Route by plan"]),
    "Route by plan": next(
      ["Create MailCheap contact"],
      ["Update MailCheap fields"],
      ["Report result to DoodleNote"],
    ),
    "Create MailCheap contact": next(["Verify created contact"]),
    "Verify created contact": next(["Check created contact"]),
    "Check created contact": next(["Report result to DoodleNote"]),
    "Update MailCheap fields": next(["Tag MailCheap contact"]),
    "Tag MailCheap contact": next(["Verify updated contact"]),
    "Verify updated contact": next(["Check updated contact"]),
    "Check updated contact": next(["Report result to DoodleNote"]),
  },
  settings: { executionOrder: "v1", saveDataErrorExecution: "all" },
  pinData: {},
};

export function buildWorkflow() {
  return `${JSON.stringify(workflow, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // --stdout lets the test compare without a TypeScript loader rewriting the
  // embedded function source.
  if (process.argv.includes("--stdout")) process.stdout.write(buildWorkflow());
  else {
    writeFileSync(OUTPUT, buildWorkflow());
    console.log(`Wrote ${OUTPUT}`);
  }
}
