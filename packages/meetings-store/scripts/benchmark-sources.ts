/** Synthetic only. Run: pnpm --filter @repo/meetings-store exec tsx scripts/benchmark-sources.ts */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, cpus, totalmem, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { MeetingFileStore } from "../src/store";
import { SourceIndexClient } from "../src/source-index-client";
import {
  localSourceScope,
  searchOriginalSources,
} from "../src/source-projection";

const percentile = (xs: number[], q: number) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor(xs.length * q))
  ]!;
const round = (n: number) => Math.round(n * 100) / 100;
const queries = ["rarephrase", "cafe", "launch", "budget", "東京計画"];
console.log(
  JSON.stringify({
    environment: {
      node: process.versions.node,
      os: `${process.platform} ${release()}`,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      memoryGiB: round(totalmem() / 2 ** 30),
    },
    dataset:
      "1k/10k meetings; each 20 transcript segments (~5KB text), 2 personal lines; oldest meeting has rarephrase after character 1500; no summaries; deterministic synthetic PCM callback every 20ms with atomic transcript write every 200ms; 25 queries per mode; no latency target",
  }),
);
for (const count of [1000, 10000]) {
  const root = mkdtempSync(join(tmpdir(), "doodle-source-bench-"));
  const dir = join(root, "meetings");
  mkdirSync(dir);
  const body =
    "Synthetic discussion of launch planning and budget allocation. Café 東京計画. ".repeat(
      4,
    );
  for (let i = 0; i < count; i++)
    writeFileSync(
      join(dir, `meeting-${String(i).padStart(5, "0")}.json`),
      JSON.stringify({
        id: `meeting-${String(i).padStart(5, "0")}`,
        title: `Synthetic meeting ${i}`,
        createdAt: new Date(i * 100000).toISOString(),
        rawNotesMarkdown: "Personal planning notes\nFollow up",
        segments: Array.from({ length: 20 }, (_, j) => ({
          id: `s-${j}`,
          text: body + (i === 0 && j === 19 ? "rarephrase" : ""),
          speaker: "Synthetic speaker",
          channel: "mic",
          startMs: j * 1000,
          endMs: j * 1000 + 900,
          confidence: 1,
        })),
      }),
    );
  const context = {
    meetingsDir: dir,
    scope: localSourceScope(dir, true),
    authorized: true,
  };
  const store = new MeetingFileStore(dir);
  const worker = new Worker(
    `require(${JSON.stringify(fileURLToPath(import.meta.resolve("tsx/cjs")))}); require(${JSON.stringify(fileURLToPath(new URL("../src/source-index-worker.ts", import.meta.url)))});`,
    {
      eval: true,
      workerData: { meetingsDir: dir, cacheDir: join(root, "cache") },
    },
  );
  const client = new SourceIndexClient(worker, () => context);
  const rebuildStart = performance.now();
  await client.search("rarephrase");
  const rebuildMs = performance.now() - rebuildStart;
  const repeatStart = performance.now();
  await client.search("rarephrase");
  const repeatQueryMs = performance.now() - repeatStart;
  const abort = new AbortController();
  let cancelledAt = 0;
  const ack = new Promise<number>((resolve) => {
    const listener = (m: { cancelled?: boolean }) => {
      if (m.cancelled) {
        worker.off("message", listener);
        resolve(performance.now() - cancelledAt);
      }
    };
    worker.on("message", listener);
  });
  const pending = client.search("rarephrase", 50, abort.signal);
  await new Promise((r) => setTimeout(r, 2));
  cancelledAt = performance.now();
  abort.abort();
  await pending.catch(() => {});
  const cancelToRejectMs = performance.now() - cancelledAt;
  const cancelToWorkerAckMs = await ack;
  console.log(
    JSON.stringify({
      count,
      firstQueryIncludingRebuildMs: round(rebuildMs),
      repeatQueryMs: round(repeatQueryMs),
      cancelToRejectMs: round(cancelToRejectMs),
      cancelToWorkerAckMs: round(cancelToWorkerAckMs),
    }),
  );
  for (const mode of [
    "baseline-main-json",
    "readonly-mcp-scan",
    "worker-index",
  ] as const) {
    let ticks = 0;
    let checksum = 0;
    const rssStart = process.memoryUsage().rss;
    let rssPeak = rssStart;
    const sampleMemory = () => {
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    };
    const pcm = new Float32Array(320);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 10) * 0.05;
    const timer = setInterval(() => {
      sampleMemory();
      ticks++;
      for (const sample of pcm) checksum += sample * sample;
      if (ticks % 10 === 0)
        store.upsert({
          id: "synthetic-capture",
          rawNotesMarkdown: `Synthetic capture ${ticks}`,
          segments: [],
        });
    }, 20);
    const delay = monitorEventLoopDelay({ resolution: 1 });
    delay.enable();
    await new Promise((r) => setTimeout(r, 25));
    const elapsedStart = performance.now();
    const durations: number[] = [];
    for (let i = 0; i < 25; i++) {
      const started = performance.now();
      const query = queries[i % queries.length]!;
      if (mode === "baseline-main-json") store.search(query);
      else if (mode === "readonly-mcp-scan")
        searchOriginalSources(context, query);
      else await client.search(query);
      durations.push(performance.now() - started);
      sampleMemory();
      await new Promise((r) => setTimeout(r, 2));
    }
    const elapsedMs = performance.now() - elapsedStart;
    clearInterval(timer);
    delay.disable();
    console.log(
      JSON.stringify({
        count,
        mode,
        rebuildMs: round(rebuildMs),
        queryP50Ms: round(percentile(durations, 0.5)),
        queryP95Ms: round(percentile(durations, 0.95)),
        eventLoopP50Ms: round(delay.percentile(50) / 1e6),
        eventLoopP95Ms: round(delay.percentile(95) / 1e6),
        eventLoopMaxMs: round(delay.max / 1e6),
        elapsedMs: round(elapsedMs),
        captureTicks: ticks,
        expectedTicksApprox: Math.floor((elapsedMs + 25) / 20),
        pcmChecksum: round(checksum),
        processRssStartMiB: round(rssStart / 2 ** 20),
        processRssPeakMiB: round(rssPeak / 2 ** 20),
      }),
    );
  }
  // Compare actual FTS tokenizers using identical projected lexical text; unicode61 cannot match infixes.
  const db = new DatabaseSync(":memory:");
  for (const tokenizer of ["unicode61", "trigram"]) {
    db.exec(
      `CREATE VIRTUAL TABLE ${tokenizer} USING fts5(text, tokenize='${tokenizer}')`,
    );
    const begin = performance.now();
    db.exec("BEGIN");
    const insert = db.prepare(`INSERT INTO ${tokenizer} VALUES (?)`);
    for (let i = 0; i < count; i++) insert.run(body);
    db.exec("COMMIT");
    const buildMs = performance.now() - begin;
    const times: number[] = [];
    for (let i = 0; i < 25; i++) {
      const begin = performance.now();
      db.prepare(
        `SELECT count(*) FROM ${tokenizer} WHERE ${tokenizer} MATCH ?`,
      ).get('"launch"');
      times.push(performance.now() - begin);
    }
    console.log(
      JSON.stringify({
        count,
        tokenizer,
        buildMs: round(buildMs),
        queryP50Ms: round(percentile(times, 0.5)),
        queryP95Ms: round(percentile(times, 0.95)),
        infixMatches: db
          .prepare(
            `SELECT count(*) n FROM ${tokenizer} WHERE ${tokenizer} MATCH '"aunch"'`,
          )
          .get()?.n,
      }),
    );
  }
  db.close();
  await client.close();
  rmSync(root, { recursive: true, force: true });
}
