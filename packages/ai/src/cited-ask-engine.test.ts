import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import * as bounded from "./bounded-request";
import * as generation from "./generation-control";
import * as ask from "./ask-prompt";
import * as globalAsk from "./global-ask-prompt";
import * as cited from "./cited-ask-prompt";
import * as mapReduce from "./map-reduce";
import type { NotesEngine } from "./types";

test("actual local adapter reports exact wrapper wire and cleans up success, abort, failure and output limit", async () => {
  let disposed = 0;
  let generated = 0;
  let downloads = 0;
  let lastWire = "";
  let mode = "success";
  const tokenizer = (text: string) =>
    Array.from(new TextEncoder().encode(text));
  class Session {
    constructor(readonly options: { systemPrompt: string }) {}
    getChatHistory() {
      return [{ type: "system", text: this.options.systemPrompt }];
    }
    chatWrapper = {
      generateContextState: ({
        chatHistory,
      }: {
        chatHistory: Array<{ type: string; text?: string }>;
      }) => ({
        contextText: {
          tokenize: () => {
            const wire =
              chatHistory.map((h) => `<${h.type}>${h.text ?? ""}`).join("") +
              "<wrapper>";
            return tokenizer(wire);
          },
        },
      }),
    };
    async promptWithMeta(
      user: string,
      options: { signal: AbortSignal; maxTokens: number },
    ) {
      generated++;
      lastWire = JSON.stringify(
        this.chatWrapper
          .generateContextState({
            chatHistory: [
              ...this.getChatHistory(),
              { type: "user", text: user },
              { type: "model" },
            ],
          })
          .contextText.tokenize(),
      );
      assert.ok(JSON.parse(lastWire).length + options.maxTokens + 256 <= 8192);
      if (mode === "error") throw new Error("synthetic model failure");
      if (mode === "cancel")
        await new Promise((_, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        );
      return {
        responseText: '{"status":"answered","claims":[]}',
        stopReason: mode === "limit" ? "maxTokens" : "eogToken",
      };
    }
  }
  const deps: Record<string, unknown> = {
    "node:os": os,
    "node:path": path,
    "./bounded-request": bounded,
    "./generation-control": generation,
    "./ask-prompt": ask,
    "./global-ask-prompt": globalAsk,
    "./cited-ask-prompt": cited,
    "./map-reduce": mapReduce,
    "node-llama-cpp": {
      resolveModelFile: () => {
        downloads++;
        throw new Error("forbidden download");
      },
      getLlama: async () => ({
        loadModel: async () => ({
          tokenizer,
          createContext: async () => ({
            contextSize: 8192,
            getSequence: () => ({}),
            dispose: async () => {
              disposed++;
            },
          }),
        }),
      }),
      LlamaChatSession: Session,
    },
  };
  const exports: Record<string, new (options: unknown) => NotesEngine> = {};
  runInNewContext(
    ts.transpileModule(readFileSync("src/local-engine.ts", "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
      console,
      Date,
    },
  );
  const engine = new exports.LocalNotesEngine!({
    modelUri: "fixture",
    modelPath: "/synthetic/model.gguf",
  });
  assert.equal(typeof engine.askWithEvidence, "function");
  const input: cited.CitedPromptInput = {
    purpose: "library-ask",
    question: "Orchid?",
    coverage: "complete scan",
    terms: ["orchid"],
    ranges: [
      {
        id: "id",
        anchor: {
          version: 1,
          libraryId: "library",
          accountId: null,
          workspaceId: null,
          meetingId: "old",
          revisionId: "a".repeat(64),
          sourceId: "personal:0",
          kind: "personal",
        },
        startUtf16: 0,
        endUtf16: 13,
        quote: "Orchid Friday",
        title: "Old",
        occurredAt: null,
      },
    ],
  };
  const result = await engine.askWithEvidence!(input, {});
  assert.equal(result.inclusion.wireSha256, cited.hashCitedWire(lastWire));
  assert.equal(disposed, 1);
  await engine.askWithEvidence!({ ...input, ranges: [] }, {});
  assert.equal(generated, 1);
  assert.equal(disposed, 2);
  mode = "error";
  await assert.rejects(engine.askWithEvidence!(input, {}), /synthetic/);
  assert.equal(disposed, 3);
  mode = "limit";
  await assert.rejects(engine.askWithEvidence!(input, {}), /limit/i);
  assert.equal(disposed, 4);
  mode = "cancel";
  const abort = new AbortController();
  const cancelled = engine.askWithEvidence!(input, { signal: abort.signal });
  const rejection = assert.rejects(cancelled, /cancel|abort/i);
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  await rejection;
  assert.equal(disposed, 5);
  const missing = new exports.LocalNotesEngine!({ modelUri: "fixture" });
  await assert.rejects(missing.askWithEvidence!(input, {}), /cached/i);
  assert.equal(downloads, 0);
});
