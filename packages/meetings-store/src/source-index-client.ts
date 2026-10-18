import type { Worker } from "node:worker_threads";
import type {
  SourceAnchor,
  SourceContext,
  SourceResolution,
  SourceSearchResult,
} from "./source-contract";
import type { SourceWorkerRequest } from "./source-index-worker";

export class StaleSourceRequestError extends Error {
  constructor() {
    super("Source scope or content changed. Retry retrieval.");
  }
}
export type SourceIndexState =
  "starting" | "dirty" | "reconciling" | "ready" | "unavailable" | "closed";

/** Main-thread facade: no document enumeration, parsing, hashing or SQL runs here. */
export class SourceIndexClient {
  private generation = 0;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      context: string;
      generation: number;
      cleanup: () => void;
      cancellation: Int32Array;
    }
  >();
  private readonly ready: Promise<void>;
  state: SourceIndexState = "starting";
  constructor(
    private readonly worker: Worker,
    private readonly context: () => SourceContext,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      worker.on("message", (message) => {
        if (message.ready) {
          this.state = "dirty";
          resolve();
          return;
        }
        const task = this.pending.get(message.id);
        if (!task) return;
        this.pending.delete(message.id);
        task.cleanup();
        try {
          if (
            task.generation !== this.generation ||
            task.context !== JSON.stringify(this.context())
          )
            throw new StaleSourceRequestError();
          if (message.error) throw new Error(message.error);
          task.resolve(message.result);
          this.state = this.pending.size
            ? "reconciling"
            : message.result?.freshness === "reconciled"
              ? "ready"
              : "dirty";
        } catch (error) {
          task.reject(error as Error);
          this.state = this.pending.size ? "reconciling" : "dirty";
        }
      });
      const fail = (): void => {
        this.state = "unavailable";
        const error = new Error(
          "Source worker stopped; originals are preserved.",
        );
        reject(error);
        for (const task of this.pending.values()) {
          task.cleanup();
          task.reject(error);
        }
        this.pending.clear();
      };
      worker.on("error", fail);
      worker.on("exit", fail);
    });
    // Startup failure is observable through requests/state, never an unhandled rejection.
    void this.ready.catch(() => {});
  }
  invalidate(): void {
    this.generation++;
    for (const task of this.pending.values()) {
      Atomics.store(task.cancellation, 0, 1);
      task.cleanup();
      task.reject(new StaleSourceRequestError());
    }
    this.pending.clear();
    if (this.state === "reconciling" || this.state === "ready")
      this.state = "dirty";
  }
  async search(
    query: string,
    limit = 50,
    signal?: AbortSignal,
  ): Promise<SourceSearchResult> {
    return this.request(
      { operation: "search", query, limit },
      signal,
    ) as Promise<SourceSearchResult>;
  }
  async resolve(
    anchor: SourceAnchor,
    signal?: AbortSignal,
  ): Promise<SourceResolution> {
    return this.request(
      { operation: "resolve", anchor },
      signal,
    ) as Promise<SourceResolution>;
  }
  private async request(
    input: Pick<
      SourceWorkerRequest,
      "operation" | "query" | "limit" | "anchor"
    >,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const generation = this.generation;
    await this.ready;
    if (signal?.aborted) throw new Error("Source request cancelled");
    if (this.state === "closed" || this.state === "unavailable")
      throw new Error("Source worker unavailable");
    if (generation !== this.generation) throw new StaleSourceRequestError();
    const context = this.context();
    if (!context.authorized) throw new Error("Source scope unauthorized");
    const id = ++this.nextId;
    this.state = "reconciling";
    return new Promise((resolve, reject) => {
      const cancellation = new Int32Array(new SharedArrayBuffer(4));
      const cancel = (): void => {
        Atomics.store(cancellation, 0, 1);
        this.pending.delete(id);
        cleanup();
        if (!this.pending.size) this.state = "dirty";
        reject(new Error("Source request cancelled"));
      };
      const cleanup = (): void => signal?.removeEventListener("abort", cancel);
      this.pending.set(id, {
        resolve,
        reject,
        context: JSON.stringify(context),
        generation,
        cleanup,
        cancellation,
      });
      signal?.addEventListener("abort", cancel, { once: true });
      this.worker.postMessage({
        ...input,
        id,
        generation,
        context,
        cancellation: cancellation.buffer,
      });
    });
  }
  async close(): Promise<void> {
    this.invalidate();
    await this.worker.terminate();
    this.state = "closed";
  }
}
