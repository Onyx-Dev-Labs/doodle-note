"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
  shareToken,
  shareExpiresAt,
  shareIncludeTranscript,
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
  shareToken: string | null;
  shareExpiresAt: string | null;
  shareIncludeTranscript: boolean;
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
  const [includeTranscript, setIncludeTranscript] = useState(shareIncludeTranscript);
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [currentShareToken, setCurrentShareToken] = useState(shareToken);
  const [currentShareExpiry, setCurrentShareExpiry] = useState(shareExpiresAt);
  const [targetOrganizationId, setTargetOrganizationId] = useState(organizationId);
  const [targetFolderId, setTargetFolderId] = useState(folderId ?? "");
  const [tagText, setTagText] = useState(tags.join(", "));

  const shareUrl = currentShareToken ? `/share/${currentShareToken}` : null;
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

  async function updateShare(enable: boolean) {
    startAction();
    try {
      const response = await fetch(`/api/meetings/${meetingId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enable,
          includeTranscript,
          expiresInDays: Number(expiresInDays),
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        url?: string | null;
        expiresAt?: string | null;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not update sharing");
      const token = body.url?.split("/").pop() ?? null;
      setCurrentShareToken(token);
      setCurrentShareExpiry(body.expiresAt ?? null);
      setMessage(enable ? "Secure link updated." : "Public link revoked.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update sharing");
    } finally {
      setPending(false);
    }
  }

  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(
        new URL(shareUrl, window.location.origin).toString(),
      );
      setMessage("Share link copied.");
    } catch {
      setError(new URL(shareUrl, window.location.origin).toString());
    }
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

      {shareOpen && (
        <section className="mt-4 rounded-xl border border-sand bg-card p-4" aria-label="Share settings">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-ink">Secure sharing</h2>
              <p className="mt-1 text-xs leading-relaxed text-stone">Anyone with the link can read the selected content until you revoke it or it expires.</p>
            </div>
            <button type="button" onClick={() => setShareOpen(false)} aria-label="Close share settings" className="rounded-md px-2 py-1 text-stone hover:bg-sage-fill hover:text-ink">×</button>
          </div>
          <label className="mt-4 flex items-start gap-2 text-sm text-bark">
            <input type="checkbox" checked={includeTranscript} onChange={(event) => setIncludeTranscript(event.target.checked)} className="mt-0.5 h-4 w-4 accent-sage-deep" />
            <span><strong className="text-ink">Include transcript</strong><span className="block text-xs text-stone">Off by default so sharing notes does not expose the full conversation.</span></span>
          </label>
          <label className="mt-4 block text-xs font-medium text-bark">
            Link expires
            <select value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} className="mt-1 w-full rounded-lg border border-sand bg-card px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep">
              <option value="1">After 24 hours</option>
              <option value="7">After 7 days</option>
              <option value="30">After 30 days</option>
              <option value="0">Never</option>
            </select>
          </label>
          {shareUrl && (
            <div className="mt-4 rounded-lg bg-card-soft p-3">
              <p className="break-all text-xs text-bark">{shareUrl}</p>
              <p className="mt-1 text-[11px] text-stone">
                {currentShareExpiry ? `Expires ${new Date(currentShareExpiry).toLocaleString()}` : "Does not expire"}
              </p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => void updateShare(true)} className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-cream disabled:opacity-50">
              {pending ? "Saving…" : currentShareToken ? "Update link" : "Create link"}
            </button>
            {shareUrl && <button type="button" onClick={() => void copyShareLink()} className="rounded-lg border border-sand px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill">Copy link</button>}
            {currentShareToken && <button type="button" disabled={pending} onClick={() => void updateShare(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950">Revoke</button>}
          </div>
        </section>
      )}

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
