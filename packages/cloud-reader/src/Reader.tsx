"use client";
import { useEffect, useRef, useState } from "react";
import type {
  ReaderAction,
  ReaderDetail,
  ReaderNote,
  ReaderTransport,
} from "./types";
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const array = (value: unknown) => (Array.isArray(value) ? value : []);
const panel = {
  padding: 16,
  border: "1px solid #a8a29e",
  borderRadius: 10,
  marginBottom: 12,
};
function Preview({
  transport,
  note,
  revision,
  version,
}: {
  transport: ReaderTransport;
  note: ReaderNote;
  revision: string;
  version: string;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    setUrl(undefined);
    setError(false);
    let active = true;
    let local: string | undefined;
    transport
      .preview(note, revision, version)
      .then((bytes) => {
        if (!active) return;
        local = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        setUrl(local);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (local) URL.revokeObjectURL(local);
    };
  }, [transport, note, revision, version]);
  return error ? (
    <p role="status">Preview unavailable. Reopen this note to retry.</p>
  ) : url ? (
    <img
      src={url}
      alt="Handwritten note preview"
      style={{ maxWidth: "100%", maxHeight: 600 }}
    />
  ) : (
    <p role="status">Loading private preview…</p>
  );
}
/** Renders known fields only; mutation never serializes this display projection. */
export function Reader({ transport }: { transport: ReaderTransport }) {
  const [notes, setNotes] = useState<ReaderNote[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReaderDetail | null>(null),
    [status, setStatus] = useState("Loading cloud notes…");
  const [busy, setBusy] = useState(false),
    [confirmPurge, setConfirmPurge] = useState(false);
  const request = useRef(0),
    pending = useRef<ReaderAction | null>(null);
  const refresh = async () => {
    const seq = ++request.current;
    setBusy(true);
    setDetail(null);
    setStatus("Loading cloud notes…");
    try {
      const result = await transport.list();
      if (seq !== request.current) return;
      setNotes(result.notes);
      setNext(result.next);
      setStatus(
        result.notes.length ? "" : "No mobile notes in this workspace.",
      );
    } catch (e) {
      if (seq === request.current) {
        setNotes([]);
        setStatus(e instanceof Error ? e.message : "Cloud notes unavailable.");
      }
    } finally {
      if (seq === request.current) setBusy(false);
    }
  };
  useEffect(() => {
    pending.current = null;
    void refresh();
    return () => {
      request.current++;
    };
  }, [transport]); // transport identity is stable in each host
  const open = async (noteId: string, revisionId?: string) => {
    const seq = ++request.current;
    setBusy(true);
    setDetail(null);
    setConfirmPurge(false);
    setStatus("Loading note…");
    try {
      const result = await transport.detail({ noteId, revisionId });
      if (seq !== request.current) return;
      setDetail(result);
      setStatus("");
      pending.current = null;
    } catch (e) {
      if (seq === request.current)
        setStatus(e instanceof Error ? e.message : "Note unavailable.");
    } finally {
      if (seq === request.current) setBusy(false);
    }
  };
  const perform = async (kind: ReaderAction["kind"]) => {
    if (!detail || busy) return;
    const seq = ++request.current;
    const n = detail.note;
    const value: ReaderAction = {
      kind,
      libraryId: n.libraryId,
      noteId: n.id,
      operationId: pending.current?.operationId ?? crypto.randomUUID(),
      expectedRevision: n.headRevision,
      expectedLifecycleGeneration: n.generation,
      ...(kind === "choose"
        ? { selectedRevision: detail.selectedRevision! }
        : {}),
      ...((kind === "restore" || kind === "purge") && n.deletionId
        ? { deletionId: n.deletionId }
        : {}),
    };
    if (pending.current && pending.current.kind !== kind)
      value.operationId = crypto.randomUUID();
    pending.current = value;
    setBusy(true);
    try {
      const receipt = await transport.action(value);
      if (seq !== request.current) return;
      if (receipt.status !== "ok") {
        pending.current = null;
        setDetail(null);
        setStatus(
          "This note changed or is no longer available. Refresh before trying again.",
        );
        return;
      }
      pending.current = null;
      setConfirmPurge(false);
      await refresh();
    } catch (e) {
      if (seq === request.current)
        setStatus(
          e instanceof Error ? e.message : "Request failed. Retry is safe.",
        );
    } finally {
      if (seq === request.current) setBusy(false);
    }
  };
  const snapshot = object(detail?.snapshot);
  const speakers = new Map(
    array(snapshot.speakers).map((value) => {
      const s = object(value);
      return [text(s.id), text(s.displayName, "Speaker")];
    }),
  );
  const summaries = array(snapshot.summaries).map(object);
  const summary = summaries.find((s) => s.id === snapshot.selectedSummaryId);
  const legacy = Boolean(snapshot.meeting) && !snapshot.sourceRevisionId;
  return (
    <section
      style={{
        padding: 24,
        maxWidth: 1100,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
      aria-label="Mobile cloud notes"
    >
      <h1>Mobile cloud notes</h1>
      <p>
        Read notes from this linked workspace. Recording audio remains on the
        device that captured it.
      </p>
      <button onClick={() => void refresh()} disabled={busy}>
        Refresh
      </button>
      {status && <p role="status">{status}</p>}
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 16 }}
      >
        <nav aria-label="Cloud note list" style={{ flex: "1 1 230px" }}>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {notes.map((n) => (
              <li key={n.id} style={{ marginBottom: 8 }}>
                <button
                  onClick={() => void open(n.id)}
                  disabled={busy}
                  style={{ width: "100%", textAlign: "left", padding: 10 }}
                >
                  {n.title} {n.state === "trashed" ? "(Trash)" : ""}
                </button>
              </li>
            ))}
          </ul>
          {next && (
            <button
              disabled={busy}
              onClick={async () => {
                const seq = ++request.current;
                setBusy(true);
                try {
                  const more = await transport.list(next);
                  if (seq !== request.current) return;
                  setNotes((old) => [
                    ...old,
                    ...more.notes.filter(
                      (n) => !old.some((o) => o.id === n.id),
                    ),
                  ]);
                  setNext(more.next);
                } catch {
                  if (seq === request.current)
                    setStatus("Could not load more notes. Retry.");
                } finally {
                  if (seq === request.current) setBusy(false);
                }
              }}
            >
              More notes
            </button>
          )}
        </nav>
        {detail && (
          <article
            style={{ flex: "3 1 450px", minWidth: 0 }}
            aria-label="Selected note"
          >
            <h2>{detail.note.title}</h2>
            <p role="note">
              Text and Pencil editing are not supported here. Original fields
              and all retained versions stay in the cloud. Use the mobile app to
              edit.
            </p>
            <p>
              State: {detail.note.state}
              {detail.note.expiresAt
                ? ` · Recoverable until ${new Date(detail.note.expiresAt).toLocaleString()}`
                : ""}
            </p>
            <label>
              Retained version{" "}
              <select
                disabled={busy}
                value={detail.selectedRevision ?? ""}
                onChange={(e) => void open(detail.note.id, e.target.value)}
              >
                {detail.selectedRevision &&
                  !detail.versions.some(
                    (v) => v.id === detail.selectedRevision,
                  ) && (
                    <option value={detail.selectedRevision}>
                      Selected older version
                    </option>
                  )}
                {detail.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {new Date(v.createdAt).toLocaleString()} · {v.kind}
                    {v.id === detail.note.contentRevision ? " · current" : ""}
                  </option>
                ))}
              </select>
            </label>
            {detail.next && (
              <button
                disabled={busy}
                onClick={async () => {
                  const seq = ++request.current;
                  setBusy(true);
                  try {
                    const more = await transport.detail({
                      noteId: detail.note.id,
                      revisionId: detail.selectedRevision ?? undefined,
                      after: detail.next!,
                    });
                    if (seq !== request.current) return;
                    setDetail({
                      ...detail,
                      versions: [...detail.versions, ...more.versions],
                      next: more.next,
                    });
                  } catch {
                    if (seq === request.current)
                      setStatus("History unavailable. Retry.");
                  } finally {
                    if (seq === request.current) setBusy(false);
                  }
                }}
              >
                Older versions
              </button>
            )}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                margin: "12px 0",
              }}
            >
              {detail.note.state === "active" ? (
                <>
                  <button
                    disabled={
                      busy ||
                      legacy ||
                      detail.selectedRevision === detail.note.contentRevision
                    }
                    onClick={() => void perform("choose")}
                  >
                    Use selected version
                  </button>
                  <button disabled={busy} onClick={() => void perform("trash")}>
                    Move to Trash
                  </button>
                </>
              ) : (
                <>
                  <button
                    disabled={busy}
                    onClick={() => void perform("restore")}
                  >
                    Restore note
                  </button>
                  <button disabled={busy} onClick={() => setConfirmPurge(true)}>
                    Delete permanently…
                  </button>
                </>
              )}
            </div>
            {confirmPurge && (
              <div role="alert" style={panel}>
                <p>
                  Permanently delete this cloud note and all its versions and
                  handwriting? This cannot be undone.
                </p>
                <button disabled={busy} onClick={() => void perform("purge")}>
                  Confirm permanent deletion
                </button>{" "}
                <button onClick={() => setConfirmPurge(false)}>Cancel</button>
              </div>
            )}
            {legacy ? (
              <p>
                This retained desktop version uses an older format. It is
                preserved; reopen it in its original client. It cannot replace a
                mobile version here.
              </p>
            ) : (
              <>
                <section style={panel}>
                  <h3>Personal notes</h3>
                  <pre
                    style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}
                  >
                    {text(snapshot.text, "No personal notes.")}
                  </pre>
                </section>
                <section style={panel}>
                  <h3>Selected summary</h3>
                  <pre
                    style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}
                  >
                    {summary ? text(summary.markdown) : "No selected summary."}
                  </pre>
                </section>
                <section style={panel}>
                  <h3>Transcript</h3>
                  <p>
                    Audio playback is unavailable here; audio is not synced.
                  </p>
                  {array(snapshot.passages).map((value, i) => {
                    const p = object(value);
                    return (
                      <p key={text(p.id, String(i))}>
                        <strong>
                          {speakers.get(text(p.speakerId)) ??
                            "Unidentified speaker"}
                        </strong>
                        {typeof p.startMs === "number"
                          ? ` (${Math.floor(p.startMs / 60000)}:${String(Math.floor(p.startMs / 1000) % 60).padStart(2, "0")})`
                          : ""}
                        <br />
                        {text(p.text)}
                      </p>
                    );
                  })}
                </section>
                <section style={panel}>
                  <h3>Handwriting</h3>
                  {array(snapshot.inkAttachments).length === 0 ? (
                    <p>No handwriting.</p>
                  ) : (
                    array(snapshot.inkAttachments).map((value) => {
                      const v = object(value);
                      return (
                        <Preview
                          key={`${detail.selectedRevision}:${text(v.versionId)}`}
                          transport={transport}
                          note={detail.note}
                          revision={detail.selectedRevision!}
                          version={text(v.versionId)}
                        />
                      );
                    })
                  )}
                </section>
              </>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
