import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import type { GbnfJsonSchema } from "node-llama-cpp";
import * as bounded from "./bounded-request";
import * as generation from "./generation-control";
import * as ask from "./ask-prompt";
import * as globalAsk from "./global-ask-prompt";
import * as cited from "./cited-ask-prompt";
import * as mapReduce from "./map-reduce";
import type { LocalNotesEngine } from "./local-engine";

// Pure installed 3.20 schema utilities only; never import the native entry point.
const entry = import.meta.resolve("node-llama-cpp");
assert.equal(
  JSON.parse(readFileSync(new URL("../package.json", entry), "utf8")).version,
  "3.20.0",
);
const { validateObjectAgainstGbnfSchema: validate } = (await import(
  new URL("./utils/gbnfJson/utils/validateObjectAgainstGbnfSchema.js", entry)
    .href
)) as {
  validateObjectAgainstGbnfSchema(
    value: unknown,
    schema: GbnfJsonSchema,
  ): boolean;
};
const { getGbnfGrammarForGbnfJsonSchema: compile } = (await import(
  new URL("./utils/gbnfJson/getGbnfGrammarForGbnfJsonSchema.js", entry).href
)) as {
  getGbnfGrammarForGbnfJsonSchema(schema: GbnfJsonSchema): string;
};
const input: cited.CitedPromptInput = {
  purpose: "library-ask",
  question: "When is Orchid?",
  coverage: "complete scan",
  terms: ["orchid"],
  ranges: [
    {
      id: "wire-one",
      anchor: {
        version: 1,
        libraryId: "synthetic",
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
const claim = (
  id = "claim-1",
  kind = "paraphrase",
  evidenceIds = ["wire-one"],
) => ({ id, text: "Orchid Friday", kind, evidenceIds });

test("pinned pure schema compiler enforces status, total claim/ref caps and exact included IDs", () => {
  assert.equal(typeof cited.buildCitedAnswerSchema, "function");
  const schema = cited.buildCitedAnswerSchema([
    { id: "wire-one" },
    { id: "wire-two" },
  ]);
  const gbnf = compile(schema);
  assert.match(gbnf, /root ::=/);
  assert.ok(gbnf.includes("wire-one") && gbnf.includes("wire-two"));
  for (const value of [
    { status: "insufficient-evidence", claims: [] },
    { status: "answered", claims: [claim()] },
    {
      status: "answered",
      claims: Array.from({ length: 12 }, (_, i) => claim(`claim-${i + 1}`)),
    },
    {
      status: "conflicting-evidence",
      claims: [claim("claim-1", "conflict", ["wire-one", "wire-two"])],
    },
    {
      status: "conflicting-evidence",
      claims: [
        claim("claim-1", "conflict", ["wire-one", "wire-two"]),
        ...Array.from({ length: 11 }, (_, i) => claim(`claim-${i + 2}`)),
      ],
    },
    // Parser permits a conflict claim under answered; do not tighten reverse implication.
    {
      status: "answered",
      claims: [claim("claim-1", "conflict", ["wire-one", "wire-two"])],
    },
  ])
    assert.equal(validate(value, schema), true);
  for (const value of [
    { status: "answered", claims: [] },
    { status: "insufficient-evidence", claims: [claim()] },
    { status: "conflicting-evidence", claims: [claim()] },
    {
      status: "conflicting-evidence",
      claims: [claim(), claim("claim-2", "conflict", ["wire-one", "wire-two"])],
    },
    { status: "conflicting-evidence", claims: [claim("claim-1", "conflict")] },
    {
      status: "answered",
      claims: [claim("claim-1", "paraphrase", ["omitted-parent"])],
    },
    { status: "answered", claims: [claim("claim-1", "paraphrase", [])] },
    {
      status: "answered",
      claims: [claim("claim-1", "paraphrase", Array(5).fill("wire-one"))],
    },
    { status: "answered", claims: Array.from({ length: 13 }, () => claim()) },
    {
      status: "conflicting-evidence",
      claims: [
        claim("claim-1", "conflict", ["wire-one", "wire-two"]),
        ...Array.from({ length: 12 }, () => claim()),
      ],
    },
    { status: "answered", claims: [{ ...claim(), text: "" }] },
    { status: "answered", claims: [{ ...claim(), text: "x".repeat(4097) }] },
    { status: "answered", claims: [{ ...claim(), url: "file:///private" }] },
  ])
    assert.throws(() => validate(value, schema));
  const one = cited.buildCitedAnswerSchema([
    { id: "wire-one" },
    { id: "wire-one" },
  ]);
  assert.throws(() =>
    validate(
      {
        status: "answered",
        claims: [claim("claim-1", "conflict", ["wire-one", "wire-one"])],
      },
      one,
    ),
  );
  assert.throws(() => cited.buildCitedAnswerSchema([]), /evidence/i);
  assert.throws(
    () =>
      cited.buildCitedAnswerSchema(
        Array.from({ length: 25 }, (_, i) => ({ id: String(i) })),
      ),
    /evidence/i,
  );
  // Schema lacks uniqueItems/nonblank semantics: strict production parser still owns them.
  assert.equal(
    validate({ status: "answered", claims: [claim(), claim()] }, schema),
    true,
  );
  assert.equal(
    validate(
      { status: "answered", claims: [{ ...claim(), text: "   " }] },
      schema,
    ),
    true,
  );
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(
  options: {
    compile?: () => Promise<void>;
    beforeCount?: () => void;
    failDefaultContext?: boolean;
    deadlineMs?: number;
    stopReason?: string;
    raw?: string;
  } = {},
) {
  const schemas: GbnfJsonSchema[] = [],
    grammars: unknown[] = [],
    calls: Array<{ user: string; grammar?: unknown; maxTokens: number }> = [];
  const grammarRuntimes: string[] = [],
    disposed: string[] = [];
  let lastWire: number[] = [];
  const deps: Record<string, unknown> = {
    "node:os": os,
    "node:path": path,
    "./bounded-request": bounded,
    "./generation-control": {
      ...generation,
      withGenerationDeadline: (
        parent: AbortSignal | undefined,
        phase: generation.GenerationPhase,
        work: (s: AbortSignal) => Promise<unknown>,
      ) =>
        generation.withGenerationDeadline(
          parent,
          phase,
          work,
          options.deadlineMs,
        ),
    },
    "./ask-prompt": ask,
    "./global-ask-prompt": globalAsk,
    "./cited-ask-prompt": cited,
    "./map-reduce": mapReduce,
    "node-llama-cpp": {
      NoBinaryFoundError: class extends Error {},
      resolveModelFile: () => assert.fail("no download"),
      getLlama: async ({ gpu }: { gpu?: false }) => {
        const runtime = gpu === false ? "cpu" : "default";
        return {
          createGrammarForJsonSchema: async (schema: GbnfJsonSchema) => {
            schemas.push(schema);
            grammarRuntimes.push(runtime);
            await options.compile?.();
            const grammar = { schema, runtime };
            grammars.push(grammar);
            return grammar;
          },
          loadModel: async () => ({
            tokenizer: () => [],
            dispose: async () => {},
            createContext: async () => {
              if (options.failDefaultContext && runtime === "default")
                throw Error("synthetic default context failure");
              return {
                contextSize: 8192,
                getSequence: () => ({}),
                dispose: async () => {
                  disposed.push(runtime);
                },
              };
            },
          }),
        };
      },
      LlamaChatSession: class {
        constructor(readonly opts: { systemPrompt: string }) {}
        getChatHistory() {
          return [{ type: "system", text: this.opts.systemPrompt }];
        }
        chatWrapper = {
          generateContextState: ({
            chatHistory,
          }: {
            chatHistory: Array<{ type: string; text?: string }>;
          }) => ({
            contextText: {
              tokenize: () => {
                options.beforeCount?.();
                lastWire = Array.from(
                  new TextEncoder().encode(
                    chatHistory
                      .map((x) => `<${x.type}>${x.text ?? ""}`)
                      .join(""),
                  ),
                );
                return lastWire;
              },
            },
          }),
        };
        async promptWithMeta(
          user: string,
          opts: { signal: AbortSignal; maxTokens: number; grammar?: unknown },
        ) {
          assert.equal(opts.signal.aborted, false);
          calls.push({
            user,
            grammar: opts.grammar,
            maxTokens: opts.maxTokens,
          });
          return {
            responseText:
              options.raw ?? '{"status":"insufficient-evidence","claims":[]}',
            stopReason: options.stopReason ?? "eogToken",
          };
        }
      },
    },
  };
  const exports: { LocalNotesEngine?: typeof LocalNotesEngine } = {};
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
      console: { error() {} },
      Date,
    },
  );
  const engine = new exports.LocalNotesEngine!({
    modelUri: "fixture",
    modelPath: "/synthetic/model.gguf",
  });
  return {
    engine,
    schemas,
    grammars,
    calls,
    grammarRuntimes,
    disposed,
    wire: () => lastWire,
  };
}

test("real adapter creates and passes request-local grammar for final shortened/omitted wire IDs only", async () => {
  const f = fixture();
  const long = "😀".repeat(500) + " Orchid Friday " + "界".repeat(1000);
  const result = await f.engine.askWithEvidence(
    {
      ...input,
      ranges: [
        {
          ...input.ranges[0]!,
          id: "retrieved-parent",
          quote: long,
          endUtf16: long.length,
        },
        { ...input.ranges[0]!, id: "omitted-parent", title: "x".repeat(10000) },
      ],
    },
    {},
  );
  assert.equal(
    f.schemas.length,
    1,
    "compile grammar for actual cited generation",
  );
  assert.equal(f.calls[0]!.grammar, f.grammars[0]);
  const wire = JSON.parse(f.calls[0]!.user);
  assert.equal(wire.evidence.length, 1);
  assert.notEqual(wire.evidence[0].id, "retrieved-parent");
  assert.equal(
    validate(
      {
        status: "answered",
        claims: [claim("claim-1", "paraphrase", [wire.evidence[0].id])],
      },
      f.schemas[0]!,
    ),
    true,
  );
  for (const id of ["retrieved-parent", "omitted-parent", "gold-not-supplied"])
    assert.throws(() =>
      validate(
        { status: "answered", claims: [claim("claim-1", "paraphrase", [id])] },
        f.schemas[0]!,
      ),
    );
  assert.equal(result.inclusion.inputTokens, f.wire().length);
  assert.equal(
    result.inclusion.wireSha256,
    cited.hashCitedWire(JSON.stringify(f.wire())),
  );
  assert.equal(f.calls[0]!.maxTokens, 4096);
  assert.ok(f.wire().length + 4096 + 256 <= 8192);
  assert.deepEqual(f.disposed, ["default"]);
  await f.engine.askWithEvidence(input, {});
  assert.notEqual(f.calls[1]!.grammar, f.calls[0]!.grammar);
  assert.throws(() =>
    validate({ status: "answered", claims: [claim()] }, f.schemas[0]!),
  );
});

test("zero included IDs skip grammar/inference; generic generation stays unconstrained", async () => {
  const f = fixture();
  for (const ranges of [
    [],
    [{ ...input.ranges[0]!, title: "x".repeat(10000) }],
  ]) {
    const r = await f.engine.askWithEvidence({ ...input, ranges }, {});
    assert.equal(r.rawJson, null);
  }
  assert.equal(f.schemas.length, 0);
  assert.equal(f.calls.length, 0);
  await f.engine.runRaw("generic", "question");
  assert.equal(f.schemas.length, 0);
  assert.equal(f.calls[0]!.grammar, undefined);
  assert.equal(f.disposed.length, 3);
});

test("grammar uses current runtime after context recovery and never repairs raw response or maxTokens", async () => {
  const raw = '{"status":"answered","claims":[]}"';
  const f = fixture({ failDefaultContext: true, raw });
  assert.equal((await f.engine.askWithEvidence(input, {})).rawJson, raw);
  assert.deepEqual(f.grammarRuntimes, ["cpu"]);
  assert.deepEqual(f.disposed, ["cpu"]);
  const limit = fixture({ stopReason: "maxTokens" });
  await assert.rejects(limit.engine.askWithEvidence(input, {}), /limit/i);
  assert.equal(limit.schemas.length, 1);
  assert.equal(limit.disposed.length, 1);
});

test("cancel before grammar compilation prevents compile and inference", async () => {
  const abort = new AbortController();
  const f = fixture({ beforeCount: () => abort.abort() });
  await assert.rejects(
    f.engine.askWithEvidence(input, { signal: abort.signal }),
    /abort/i,
  );
  assert.equal(f.schemas.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.disposed.length, 1);
});
for (const stop of ["cancel", "deadline", "compile-error"] as const) {
  test(`${stop} during grammar creation holds context ownership until compilation settles`, async () => {
    const started = deferred(),
      release = deferred(),
      abort = new AbortController();
    const f = fixture({
      deadlineMs: stop === "deadline" ? 20 : undefined,
      compile: async () => {
        started.resolve();
        await release.promise;
        if (stop === "compile-error")
          throw Error("synthetic grammar compilation failed");
      },
    });
    let settled = false;
    const pending = f.engine.askWithEvidence(input, { signal: abort.signal });
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const rejected = assert.rejects(pending, /abort|timed out|compilation/i);
    void rejected.catch(() => {}); // Attach now; the assertion is awaited after the barrier.
    // OLD returns without compiling; fail immediately instead of hanging on its unused barrier.
    await Promise.race([
      started.promise,
      pending.then(() => assert.fail("generation bypassed grammar")),
    ]);
    if (stop === "cancel") abort.abort();
    if (stop === "deadline") await new Promise((r) => setTimeout(r, 40));
    else await new Promise((r) => setImmediate(r));
    assert.equal(settled, false);
    assert.equal(f.disposed.length, 0);
    assert.equal(f.calls.length, 0);
    release.resolve();
    await rejected;
    assert.equal(f.disposed.length, 1);
    assert.equal(f.calls.length, 0);
  });
}
