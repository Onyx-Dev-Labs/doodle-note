"use client";

import { useMemo, useState } from "react";

interface TranscriptSegment {
  speaker: string;
  startMs: number;
  text: string;
}

function plainTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => {
      const total = Math.max(0, Math.round(segment.startMs / 1000));
      const time = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
      return `[${time}] ${segment.speaker}: ${segment.text}`;
    })
    .join("\n");
}

/** Recipient-only actions for a meeting shared with you: Copy notes and Export .md. */
export function SharedMeetingActions({
  title,
  markdown,
  segments,
}: {
  title: string;
  markdown: string | null;
  segments: TranscriptSegment[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exportText = useMemo(() => {
    const notes = markdown?.trim() || "_No notes were synced._";
    const transcript = plainTranscript(segments);
    return `# ${title}\n\n${notes}${transcript ? `\n\n## Transcript\n\n${transcript}` : ""}\n`;
  }, [markdown, segments, title]);

  async function copyNotes() {
    setError(null);
    try {
      await navigator.clipboard.writeText(markdown || exportText);
      setMessage(markdown ? "Notes copied." : "Meeting copied.");
    } catch {
      setError("Clipboard access was blocked by your browser.");
    }
  }

  function exportMarkdown() {
    setError(null);
    const blob = new Blob([exportText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "meeting"}.md`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Markdown exported.");
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void copyNotes()} className="rounded-lg border border-sand bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep">
          Copy notes
        </button>
        <button type="button" onClick={exportMarkdown} className="rounded-lg border border-sand bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep">
          Export .md
        </button>
      </div>
      {(message || error) && (
        <p aria-live="polite" className={`mt-3 text-sm ${error ? "text-red-700 dark:text-red-300" : "text-sage-deep"}`}>
          {error ?? message}
        </p>
      )}
    </>
  );
}
