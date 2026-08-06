"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface TranscriptSegmentRow {
  id: string;
  /** Ground truth for "is this the user"; the speaker label may be a name. */
  channel?: string | null;
  speaker: string;
  startMs: number;
  text: string;
}

export function MeetingBody({
  markdown,
  segments,
  emptyText,
  interactive = false,
  showTranscript = true,
}: {
  markdown: string | null;
  segments: TranscriptSegmentRow[];
  emptyText: string;
  interactive?: boolean;
  showTranscript?: boolean;
}) {
  const [tab, setTab] = useState<"notes" | "transcript">(
    markdown ? "notes" : "transcript",
  );
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const filteredSegments = useMemo(() => {
    const query = transcriptQuery.trim().toLocaleLowerCase();
    if (!query) return segments;
    return segments.filter(
      (segment) =>
        segment.text.toLocaleLowerCase().includes(query) ||
        segment.speaker.toLocaleLowerCase().includes(query),
    );
  }, [segments, transcriptQuery]);

  const showNotes = !interactive || tab === "notes";
  const transcriptVisible = showTranscript && (!interactive || tab === "transcript");

  return (
    <div className="min-w-0">
      {interactive && (
        <div className="mt-7 flex items-center gap-1 border-b border-sand" role="tablist" aria-label="Meeting content">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "notes"}
            onClick={() => setTab("notes")}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sage-deep ${
              tab === "notes"
                ? "border-sage-deep text-ink"
                : "border-transparent text-stone hover:text-ink"
            }`}
          >
            Notes
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "transcript"}
            onClick={() => setTab("transcript")}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sage-deep ${
              tab === "transcript"
                ? "border-sage-deep text-ink"
                : "border-transparent text-stone hover:text-ink"
            }`}
          >
            Transcript <span className="ml-1 text-xs text-stone">{segments.length}</span>
          </button>
        </div>
      )}

      {showNotes && (
        markdown ? (
          <section className={`${interactive ? "mt-5" : "mt-8"} prose-notes rounded-2xl border border-sand bg-card px-5 py-5 shadow-[0_1px_0_var(--color-sand),0_12px_32px_-20px_rgba(38,40,31,0.35)] sm:px-6`}>
            <ReactMarkdown>{markdown}</ReactMarkdown>
          </section>
        ) : (
          <p className="mt-8 rounded-xl border border-dashed border-sand bg-card-soft px-4 py-8 text-center text-sm text-stone">
            {emptyText}
          </p>
        )
      )}

      {transcriptVisible && (
        <section className={interactive ? "mt-5" : "mt-10"}>
          {!interactive && (
            <h2 className="font-display text-lg font-semibold text-ink">Transcript</h2>
          )}
          {interactive && segments.length > 0 && (
            <label className="block text-xs font-medium text-bark" htmlFor="transcript-search">
              Search transcript
              <input
                id="transcript-search"
                type="search"
                value={transcriptQuery}
                onChange={(event) => setTranscriptQuery(event.target.value)}
                placeholder="Find a phrase or speaker"
                className="mt-1 w-full rounded-lg border border-sand bg-card px-3 py-2 text-sm text-ink placeholder:text-stone focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep"
              />
            </label>
          )}
          {segments.length === 0 ? (
            <p className="mt-3 text-sm text-stone">No transcript was synced for this meeting.</p>
          ) : filteredSegments.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-sand px-4 py-8 text-center text-sm text-stone">
              No transcript lines match “{transcriptQuery}”.
            </p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl border border-sand bg-card">
              {filteredSegments.map((segment) => (
                <p
                  key={segment.id}
                  className="transcript-row border-b border-sand px-4 py-3 text-sm leading-relaxed last:border-b-0"
                >
                  <span
                    className={
                      (segment.channel ?? (segment.speaker === "You" ? "mic" : "system")) === "mic"
                        ? "font-semibold text-sage-deep"
                        : "font-semibold text-ink"
                    }
                  >
                    {segment.speaker}
                  </span>
                  <span className="ml-2 text-xs text-stone">{timestamp(segment.startMs)}</span>
                  <span className="mt-0.5 block text-bark">{segment.text}</span>
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
