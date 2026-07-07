import ReactMarkdown from "react-markdown";

/** Notes + transcript rendering shared by the app meeting page and the public share page. */

export function markdownOf(content: unknown): string | null {
  if (
    content &&
    typeof content === "object" &&
    "markdown" in content &&
    typeof (content as { markdown: unknown }).markdown === "string"
  ) {
    return (content as { markdown: string }).markdown;
  }
  return null;
}

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface TranscriptSegmentRow {
  id: string;
  speaker: string;
  startMs: number;
  text: string;
}

export function MeetingBody({
  markdown,
  segments,
  emptyText,
}: {
  markdown: string | null;
  segments: TranscriptSegmentRow[];
  emptyText: string;
}) {
  return (
    <>
      {markdown ? (
        <section className="prose-notes mt-8 rounded-2xl border border-sand bg-card px-6 py-5 shadow-[0_1px_0_var(--color-sand),0_12px_32px_-20px_rgba(38,40,31,0.35)]">
          <ReactMarkdown>{markdown}</ReactMarkdown>
        </section>
      ) : (
        <p className="mt-8 text-sm text-stone">{emptyText}</p>
      )}

      {segments.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold text-ink">
            Transcript
          </h2>
          <div className="mt-2 border-y border-sand">
            {segments.map((segment) => (
              <p
                key={segment.id}
                className="border-b border-sand py-3 text-sm leading-relaxed last:border-b-0"
              >
                <span
                  className={
                    segment.speaker === "You"
                      ? "font-semibold text-sage-deep"
                      : "font-semibold text-ink"
                  }
                >
                  {segment.speaker}
                </span>
                <span className="ml-2 text-xs text-stone">
                  {timestamp(segment.startMs)}
                </span>
                <span className="mt-0.5 block text-bark">{segment.text}</span>
              </p>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
