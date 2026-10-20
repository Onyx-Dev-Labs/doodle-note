import assert from "node:assert/strict";
import { test } from "node:test";
import { CloudNotesEngine } from "./cloud-engine";
import {
  hostedGlobalAskBudget,
  ollamaGlobalAskBudget,
  OLLAMA_GLOBAL_ASK_TEMPLATE,
} from "./global-ask-model-budget";
import { buildGlobalAskPrompt, type GlobalAskInput } from "./global-ask-prompt";

const input: GlobalAskInput = {
  meetings: [
    {
      title: "Fixture",
      dateIso: "2026-10-17",
      notesMarkdown: "x".repeat(600_000),
    },
  ],
  history: [],
  question: "What happened?",
};
const response = () =>
  Response.json({
    id: "fixture",
    object: "chat.completion",
    created: 1,
    model: "fixture",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Synthetic answer" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  });

test("hosted default constraints budget all input and enforce the same output reserve on the wire", async () => {
  const previous = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return response();
  };
  try {
    for (const [provider, model, window] of [
      ["grok", "grok-4.6", 500_000],
      ["gemini", "gemini-3.8-flash", 1_048_576],
    ] as const) {
      const engine = new CloudNotesEngine({
        provider,
        apiKey: "fixture",
        dataPolicyConfirmed: true,
      });
      const result = await engine.askAcrossMeetings(input);
      const body = calls.at(-1)!.body;
      assert.equal(body.model, model);
      assert.equal(body.max_tokens, 4096);
      assert.equal(result.coverage?.contextWindowTokens, window);
      const messages = body.messages as Array<{
        role: string;
        content: string;
      }>;
      const limits = hostedGlobalAskBudget(provider, model);
      assert.ok(
        limits.countInputTokens(messages[0]!.content, messages[1]!.content) +
          4096 +
          1024 <=
          window,
      );
    }
    // These use different wire protocols; verify request settings even when the
    // synthetic provider intentionally rejects, without calling a real API.
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(
        {
          error: {
            message: "Fixture rejection",
            type: "invalid_request_error",
          },
        },
        { status: 400 },
      );
    };
    for (const provider of ["openai", "anthropic"] as const) {
      await assert.rejects(
        new CloudNotesEngine({
          provider,
          apiKey: "fixture",
          dataPolicyConfirmed: true,
        }).askAcrossMeetings(input),
      );
      const body = calls.at(-1)!.body;
      const model = provider === "openai" ? "gpt-5" : "claude-sonnet-5";
      const limits = hostedGlobalAskBudget(provider, model);
      const prompt = buildGlobalAskPrompt(input, limits);
      assert.ok(JSON.stringify(body).includes(JSON.stringify(prompt.user)));
      assert.ok(JSON.stringify(body).includes(JSON.stringify(prompt.system)));
      assert.ok(
        prompt.coverage.inputTokens +
          limits.outputReserveTokens +
          limits.safetyMarginTokens <=
          limits.contextWindowTokens,
      );
      assert.equal(
        body[provider === "openai" ? "max_output_tokens" : "max_tokens"],
        4096,
      );
      if (provider === "openai") assert.equal(body.store, false);
    }
  } finally {
    globalThis.fetch = previous;
  }
});

test("policy denial, unknown model and oversized question fail before any hosted transmission", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unexpected request");
  };
  try {
    for (const provider of ["grok", "gemini", "anthropic", "openai"] as const) {
      await assert.rejects(
        new CloudNotesEngine({ provider, apiKey: "fixture" }).askAcrossMeetings(
          input,
        ),
        /Confirm the AI data-use/,
      );
      await assert.rejects(
        new CloudNotesEngine({
          provider,
          model: "custom-unknown",
          apiKey: "fixture",
          dataPolicyConfirmed: true,
        }).askAcrossMeetings(input),
        /Select this provider's default model/,
      );
    }
    await assert.rejects(
      new CloudNotesEngine({
        provider: "grok",
        apiKey: "fixture",
        dataPolicyConfirmed: true,
      }).askAcrossMeetings({ ...input, question: "界".repeat(500_000) }),
      /question is too long/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous;
  }
});

test("Ollama uses explicit runtime context, not trained maximum; rejects unknown or remote metadata", async () => {
  const previous = globalThis.fetch;
  let metadata: Record<string, unknown> = {
    parameters: "num_ctx 8192\n",
    template: OLLAMA_GLOBAL_ASK_TEMPLATE,
    model_info: {
      "general.architecture": "llama",
      "llama.context_length": 131072,
    },
  };
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return String(url).endsWith("/api/show")
      ? Response.json(metadata)
      : response();
  };
  try {
    const budget = await ollamaGlobalAskBudget("llama3.1");
    assert.equal(budget.contextWindowTokens, 8192);
    assert.equal(budget.outputReserveTokens, 2048);
    const prompt = buildGlobalAskPrompt(input, budget);
    assert.ok(
      prompt.coverage.inputTokens +
        budget.outputReserveTokens +
        budget.safetyMarginTokens <=
        8192,
    );
    const result = await new CloudNotesEngine({
      provider: "ollama",
      apiKey: "",
    }).askAcrossMeetings(input);
    assert.equal(result.coverage?.contextWindowTokens, 8192);
    assert.equal(calls.at(-1)!.body.max_tokens, 2048);
    assert.ok(
      calls.every((call) => call.url.startsWith("http://localhost:11434/")),
    );
    assert.deepEqual(
      calls[0]!.body,
      { model: "llama3.1" },
      "metadata request contains no meeting content",
    );
    metadata = { ...metadata, parameters: "" };
    await assert.rejects(ollamaGlobalAskBudget("llama3.1"), /explicit num_ctx/);
    metadata = {
      ...metadata,
      parameters: "num_ctx 8192",
      template: "{{ range .Messages }}{{ .Content }}{{ .Content }}{{ end }}",
    };
    await assert.rejects(
      ollamaGlobalAskBudget("custom"),
      /supported llama3-instruct/,
    );
    metadata = {
      ...metadata,
      template: OLLAMA_GLOBAL_ASK_TEMPLATE,
      remote_model: "hosted",
    };
    await assert.rejects(ollamaGlobalAskBudget("remote"), /local Llama model/);
  } finally {
    globalThis.fetch = previous;
  }
});
