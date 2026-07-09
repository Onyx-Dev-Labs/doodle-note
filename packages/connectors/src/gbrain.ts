import { buildGBrainPayload } from "./gbrain-markdown";
import {
  ConnectorError,
  type Connector,
  type FinalizedMeetingEvent,
} from "./types";

export interface GBrainConfig {
  /** Full URL of the GBrain ingestion endpoint, e.g. https://gbrain.example.com/api/ingest/doodlenote */
  endpointUrl: string;
  /** Bearer token minted by GBrain for this user. */
  apiKey: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Sends finalized meetings to a GBrain ingestion endpoint, which performs
 * the Git writeback server-side (clients never hold GitHub credentials).
 * Idempotent by construction: deterministic file paths + content_hash let
 * the server upsert; resending the same event is a no-op there.
 */
export const gbrainConnector: Connector<GBrainConfig> = {
  id: "gbrain",

  async deliver(
    event: FinalizedMeetingEvent,
    config: GBrainConfig,
  ): Promise<void> {
    if (!config.endpointUrl || !config.apiKey) {
      throw new ConnectorError(
        "GBrain connector is missing endpoint URL or API key.",
        false,
      );
    }
    const payload = buildGBrainPayload(event);
    let response: Response;
    try {
      response = await fetch(config.endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network/timeout — retryable. Never include the payload in the error.
      throw new ConnectorError(
        `GBrain endpoint unreachable: ${describe(err)}`,
        true,
      );
    }
    if (response.ok) return;
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorError(
        "GBrain rejected the API key. Check the connector settings.",
        false,
      );
    }
    if (response.status === 413) {
      throw new ConnectorError(
        "GBrain rejected the payload as too large.",
        false,
      );
    }
    // 4xx = our payload's fault (don't hammer); 5xx = server's fault (retry).
    const retryable = response.status >= 500;
    throw new ConnectorError(
      `GBrain ingestion failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      retryable,
    );
  },
};

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
