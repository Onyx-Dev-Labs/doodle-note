import type {
  EvidenceSelection,
  EvidenceBundle,
  EvidenceManifest,
  CensusRequest,
  CensusResult,
} from "./evidence-contract";
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
      drain: boolean;
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
          if (Atomics.load(task.cancellation, 0))
            throw new Error("Source request cancelled");
          if (message.error)
            throw Object.assign(new Error(message.error), {
              code: message.code,
            });
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
      const fail = (exited = false): void => {
        this.state = "unavailable";
        const error = new Error(
          "Source worker stopped; originals are preserved.",
        );
        reject(error);
        for (const [id, task] of this.pending) {
          if (task.drain && !exited) continue;
          this.pending.delete(id);
          task.cleanup();
          task.reject(error);
        }
      };
      worker.on("error", () => fail());
      worker.on("exit", () => fail(true));
    });
    // Startup failure is observable through requests/state, never an unhandled rejection.
    void this.ready.catch(() => {});
  }
  invalidate(): void {
    this.generation++;
    for (const [id, task] of this.pending) {
      Atomics.store(task.cancellation, 0, 1);
      // Cited operations retain ownership until this worker replies or exits.
      if (task.drain) continue;
      this.pending.delete(id);
      task.cleanup();
      task.reject(new StaleSourceRequestError());
    }
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
  /** Cited callers must retain their activity lease until original I/O acknowledges cancellation. */
  async resolveAcknowledged(
    anchor: SourceAnchor,
    signal?: AbortSignal,
  ): Promise<SourceResolution> {
    return this.request(
      { operation: "resolve", anchor },
      signal,
      true,
    ) as Promise<SourceResolution>;
  }
  async retrieveEvidence(
    selection: EvidenceSelection,
    signal?: AbortSignal,
  ): Promise<EvidenceBundle> {
    return this.request(
      { operation: "retrieve-evidence", selection },
      signal,
    ) as Promise<EvidenceBundle>;
  }
  async census(
    census: CensusRequest,
    signal?: AbortSignal,
  ): Promise<CensusResult> {
    return this.request(
      { operation: "census", census },
      signal,
    ) as Promise<CensusResult>;
  }
  async validateEvidence(
    manifest: EvidenceManifest,
    signal?: AbortSignal,
  ): Promise<"valid" | "stale" | "unavailable"> {
    return this.request(
      { operation: "validate-evidence", manifest },
      signal,
    ) as Promise<"valid" | "stale" | "unavailable">;
  }
  private async request(
    input: Pick<
      SourceWorkerRequest,
      | "operation"
      | "query"
      | "limit"
      | "anchor"
      | "selection"
      | "census"
      | "manifest"
    >,
    signal?: AbortSignal,
    drain = input.operation !== "search" && input.operation !== "resolve",
  ): Promise<unknown> {
    const generation = this.generation;
    await awaitSourceReady(this.ready, signal);
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
        // New operations settle only when this worker acknowledges completion/cancellation.
        // Preserve the legacy immediate UI cancellation contract for source search/resolve.
        if (drain) return;
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
        drain,
      });
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        this.worker.postMessage({
          ...input,
          id,
          generation,
          context,
          cancellation: cancellation.buffer,
        });
      } catch (error) {
        // No worker task was admitted when postMessage fails.
        this.pending.delete(id);
        cleanup();
        reject(error as Error);
      }
    });
  }
  async close(): Promise<void> {
    this.invalidate();
    await this.worker.terminate();
    this.state = "closed";
  }
}

/** Abort before readiness/retirement without scheduling a delayed request. */
export async function awaitSourceReady<T>(
  ready: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new Error("Source request cancelled");
  let cancel!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error("Source request cancelled"));
  });
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([ready, aborted]);
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
