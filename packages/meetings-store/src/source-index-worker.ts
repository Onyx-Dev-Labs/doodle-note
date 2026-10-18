import { parentPort, workerData } from "node:worker_threads";
import { resolve, sep } from "node:path";
import { DerivedSourceIndex } from "./derived-index";
import {
  localSourceScope,
  resolveOriginalSource,
  sameScope,
} from "./source-projection";
import type { SourceAnchor, SourceContext } from "./source-contract";

export interface SourceWorkerRequest {
  id: number;
  cancellation: SharedArrayBuffer;
  generation: number;
  context: SourceContext;
  operation: "search" | "resolve";
  query?: string;
  limit?: number;
  anchor?: SourceAnchor;
}

// The host supplies a private cache outside the portable library. A worker is the sole writer.
if (!parentPort) throw new Error("The source index must run in a worker");
const { meetingsDir, cacheDir } = workerData as {
  meetingsDir: string;
  cacheDir: string;
};
const originalRoot = resolve(meetingsDir);
const cacheRoot = resolve(cacheDir);
if (cacheRoot === originalRoot || cacheRoot.startsWith(originalRoot + sep))
  throw new Error("Cache must be outside originals");
const scope = localSourceScope(meetingsDir, true);
const index = new DerivedSourceIndex(cacheDir);
parentPort.postMessage({ ready: true, scope });
parentPort.on("message", (request: SourceWorkerRequest) => {
  try {
    const checkpoint = (): void => {
      if (Atomics.load(new Int32Array(request.cancellation), 0))
        throw new Error("Cancelled");
    };
    checkpoint();
    const context = request.context;
    if (!context.authorized || resolve(context.meetingsDir) !== originalRoot)
      throw new Error("Unauthorized source scope");
    // Local integration never infers ownership from sign-in. Explicit bound scopes use the shared projection API.
    if (!sameScope(localSourceScope(meetingsDir), context.scope))
      throw new Error("Source scope changed");
    const result =
      request.operation === "search"
        ? index.search(
            context,
            request.query ?? "",
            request.limit,
            request.generation,
            checkpoint,
          )
        : resolveOriginalSource(context, request.anchor!);
    checkpoint();
    parentPort!.postMessage({
      id: request.id,
      generation: request.generation,
      result,
    });
  } catch {
    parentPort!.postMessage({
      id: request.id,
      generation: request.generation,
      cancelled: Boolean(Atomics.load(new Int32Array(request.cancellation), 0)),
      error: "Source index unavailable; originals are preserved.",
    });
  }
});
