"use client";
import { useMemo } from "react";
import { Reader } from "@repo/cloud-reader";
import type { ReaderTransport } from "@repo/cloud-reader/types";
export function WebMobileReader({
  organizationId,
}: {
  organizationId: string;
}) {
  const transport = useMemo<ReaderTransport>(() => {
    async function request(
      params: Record<string, string | undefined>,
      body?: unknown,
    ) {
      const q = new URLSearchParams({ organizationId });
      for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
      const response = await fetch(`/api/app/mobile-notes?${q}`, {
        method: body ? "POST" : "GET",
        cache: "no-store",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok)
        throw new Error(
          response.status === 402
            ? "An active Cloud Sync subscription is required."
            : response.status === 401
              ? "Sign in again to read cloud notes."
              : response.status === 404
                ? "Cloud reader or note unavailable. Refresh to check."
                : "Cloud request failed. Check your connection and retry.",
        );
      return response;
    }
    return {
      list: async (after) => (await request({ after })).json(),
      detail: async (query) => (await request({ ...query })).json(),
      action: async (value) => (await request({}, value)).json(),
      preview: async (note, revision, version) =>
        new Uint8Array(
          await (
            await request({
              mode: "preview",
              libraryId: note.libraryId,
              noteId: note.id,
              revisionId: revision,
              versionId: version,
              part: "preview",
            })
          ).arrayBuffer(),
        ),
    };
  }, [organizationId]);
  return <Reader key={organizationId} transport={transport} />;
}
