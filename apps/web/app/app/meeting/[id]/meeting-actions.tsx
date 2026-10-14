"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { SharePanel } from "./share-panel";

interface TranscriptSegment {
  speaker: string;
  startMs: number;
  text: string;
}

interface OrganizationOption {
  id: string;
  name: string;
  personal: boolean;
}

interface FolderOption {
  id: string;
  organizationId: string;
  name: string;
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

export function MeetingActions({
  meetingId,
  title,
  markdown,
  segments,
  organizationId,
  folderId,
  organizations,
  folders,
  tags,
}: {
  meetingId: string;
  title: string;
  markdown: string | null;
  segments: TranscriptSegment[];
  organizationId: string;
  folderId: string | null;
  organizations: OrganizationOption[];
  folders: FolderOption[];
  tags: string[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [targetOrganizationId, setTargetOrganizationId] = useState(organizationId);
  const [targetFolderId, setTargetFolderId] = useState(folderId ?? "");
  const [tagText, setTagText] = useState(tags.join(", "));

  const exportText = useMemo(() => {
    const notes = markdown?.trim() || "_No notes were synced._";
    const transcript = plainTranscript(segments);
    return `# ${title}\n\n${notes}${transcript ? `\n\n## Transcript\n\n${transcript}` : ""}\n`;
  }, [markdown, segments, title]);
  const currentOrganization = organizations.find(
    (organization) => organization.id === organizationId,
  );
  const availableFolders = folders.filter(
    (folder) => folder.organizationId === targetOrganizationId,
  );

  function startAction() {
    setError(null);
    setMessage(null);
    setPending(true);
  }

  async function copyNotes() {
    try {
      await navigator.clipboard.writeText(markdown || exportText);
      setMessage(markdown ? "Notes copied." : "Meeting copied.");
    } catch {
      setError("Clipboard access was blocked by your browser.");
    }
  }

  function exportMarkdown() {
    const blob = new Blob([exportText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "meeting"}.md`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Markdown exported.");
  }

  async function moveMeeting() {
    startAction();
    try {
      const response = await fetch(`/api/meetings/${meetingId}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: targetOrganizationId,
          folderId: targetFolderId || null,
        }),
      });
      const body = (await response.json()) as { error?: string; workspaceName?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not move the meeting");
      setMessage(`Moved to ${body.workspaceName}.`);
      router.push("/app");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move the meeting");
      setPending(false);
    }
  }

  async function saveTags() {
    startAction();
    try {
      const nextTags = tagText.split(",").map((tag) => tag.trim()).filter(Boolean);
      const response = await fetch(`/api/meetings/${meetingId}/tags`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags: nextTags }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save tags");
      setMessage("Tags saved.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save tags");
    } finally {
      setPending(false);
    }
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
        <button type="button" onClick={() => setShareOpen((open) => !open)} aria-expanded={shareOpen} className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-cream hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep">
          Share
        </button>
      </div>

      {(message || error) && (
        <p aria-live="polite" className={`mt-3 text-sm ${error ? "text-red-700 dark:text-red-300" : "text-sage-deep"}`}>
          {error ?? message}
        </p>
      )}

      {shareOpen && <SharePanel meetingId={meetingId} title={title} onClose={() => setShareOpen(false)} />}

      <section className="mt-5 rounded-xl border border-sand bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone">Privacy &amp; location</p>
        <p className="mt-2 text-sm font-medium text-ink">
          {currentOrganization?.personal ? "Personal · Private to you" : `${currentOrganization?.name ?? "Workspace"} · Visible to workspace members`}
        </p>
        <label className="mt-4 block text-xs font-medium text-bark">
          Workspace
          <select value={targetOrganizationId} onChange={(event) => { setTargetOrganizationId(event.target.value); setTargetFolderId(""); }} className="mt-1 w-full rounded-lg border border-sand bg-card px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep">
            {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}{organization.personal ? " (private)" : " (shared)"}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-xs font-medium text-bark">
          Space
          <select value={targetFolderId} onChange={(event) => setTargetFolderId(event.target.value)} className="mt-1 w-full rounded-lg border border-sand bg-card px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep">
            <option value="">Unfiled</option>
            {availableFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        {targetOrganizationId !== organizationId && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            Moving this meeting changes who can see it. Existing public links and workspace-specific tags will be removed.
          </p>
        )}
        <button type="button" disabled={pending || (targetOrganizationId === organizationId && targetFolderId === (folderId ?? ""))} onClick={() => void moveMeeting()} className="mt-3 rounded-lg border border-sand bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill disabled:opacity-50">
          Move meeting
        </button>
      </section>

      <section className="mt-4 rounded-xl border border-sand bg-card p-4">
        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-stone" htmlFor="meeting-tags">Tags</label>
        <input id="meeting-tags" value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="customer, follow-up" className="mt-2 w-full rounded-lg border border-sand bg-card px-3 py-2 text-sm text-ink placeholder:text-stone focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep" />
        <p className="mt-1 text-[11px] text-stone">Separate up to 10 tags with commas.</p>
        <button type="button" disabled={pending} onClick={() => void saveTags()} className="mt-3 rounded-lg border border-sand bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill disabled:opacity-50">Save tags</button>
      </section>
    </>
  );
}
