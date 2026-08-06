/**
 * Speaker identity: the one place that decides what name a transcript line
 * carries. Every surface (desktop transcript, exports, notes prompts, MCP,
 * connectors, cloud sync) resolves labels through here so a name assigned
 * once shows up everywhere.
 *
 * Model: `channel` stays the ground truth (mic = the DoodleNote user,
 * system = the far side). `speakerId` is a stable identity key derived from
 * the channel today and from diarization clusters later. `speaker` is only a
 * cached display label — `participants` wins whenever it knows the id.
 */

import type {
  MeetingChannel,
  MeetingParticipant,
  ParticipantSource,
  TranscriptSegment,
} from "./types";

/** The DoodleNote user — always the mic channel. */
export const SELF_SPEAKER_ID = "self";
/** The far side as a single voice; diarization will add far-2, far-3, … */
export const FAR_SPEAKER_ID = "far";

export const DEFAULT_SELF_LABEL = "You";
export const DEFAULT_FAR_LABEL = "Them";

/** Matches the cloud `speaker` column cap in apps/web sync push. */
export const MAX_SPEAKER_NAME_LENGTH = 40;

export function defaultSpeakerId(channel: MeetingChannel): string {
  return channel === "mic" ? SELF_SPEAKER_ID : FAR_SPEAKER_ID;
}

export function defaultSpeakerLabel(channel: MeetingChannel): string {
  return channel === "mic" ? DEFAULT_SELF_LABEL : DEFAULT_FAR_LABEL;
}

/** Segments recorded before speaker ids fall back to their channel default. */
export function speakerIdOf(
  segment: Pick<TranscriptSegment, "channel" | "speakerId">,
): string {
  const id = segment.speakerId?.trim();
  return id !== undefined && id.length > 0
    ? id
    : defaultSpeakerId(segment.channel);
}

/**
 * Names come from calendar invites, models and free text, so they are
 * trimmed, stripped of control characters and newlines, and capped before
 * they can become a transcript label.
 */
export function sanitizeSpeakerName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.replace(/\s+/g, " ").slice(0, MAX_SPEAKER_NAME_LENGTH).trim();
}

export function findParticipant(
  participants: readonly MeetingParticipant[] | undefined,
  speakerId: string,
): MeetingParticipant | undefined {
  return participants?.find((p) => p.id === speakerId);
}

/** The label a segment should display: participant name, else its own label. */
export function speakerLabel(
  segment: Pick<TranscriptSegment, "channel" | "speaker" | "speakerId">,
  participants?: readonly MeetingParticipant[],
): string {
  const named = findParticipant(participants, speakerIdOf(segment));
  if (named && named.name.length > 0) return named.name;
  const own = segment.speaker?.trim();
  return own !== undefined && own.length > 0
    ? own
    : defaultSpeakerLabel(segment.channel);
}

/** Every segment with its label resolved — what readers/exporters render. */
export function labelSegments<T extends TranscriptSegment>(
  segments: readonly T[],
  participants?: readonly MeetingParticipant[],
): T[] {
  return segments.map((segment) => {
    const speaker = speakerLabel(segment, participants);
    return speaker === segment.speaker ? segment : { ...segment, speaker };
  });
}

/** Insert or replace one participant, keeping roster order stable. */
export function upsertParticipant(
  participants: readonly MeetingParticipant[] | undefined,
  participant: MeetingParticipant,
): MeetingParticipant[] {
  const roster = participants ? [...participants] : [];
  const at = roster.findIndex((p) => p.id === participant.id);
  if (at === -1) roster.push(participant);
  else roster[at] = participant;
  return roster;
}

/**
 * "Assign the name once, apply it across the entire transcript": records the
 * participant and relabels every segment that shares the speaker id. An
 * empty name clears the assignment and restores the channel defaults.
 */
export function renameSpeaker<T extends TranscriptSegment>(
  input: {
    segments: readonly T[];
    participants?: readonly MeetingParticipant[];
  },
  speakerId: string,
  name: string,
  source: ParticipantSource = "manual",
  confidence = 1,
): { segments: T[]; participants: MeetingParticipant[] } {
  const clean = sanitizeSpeakerName(name);
  const participants =
    clean.length === 0
      ? (input.participants ?? []).filter((p) => p.id !== speakerId)
      : upsertParticipant(input.participants, {
          id: speakerId,
          name: clean,
          source,
          confidence,
        });
  const segments = input.segments.map((segment) => {
    if (speakerIdOf(segment) !== speakerId) return segment;
    const speaker =
      clean.length > 0 ? clean : defaultSpeakerLabel(segment.channel);
    return speaker === segment.speaker ? segment : { ...segment, speaker };
  });
  return { segments, participants };
}

/**
 * The roster the DoodleNote user's own name belongs in. A profile name only
 * fills the `self` slot while nothing stronger claimed it, so a manual
 * rename is never overwritten by a settings change.
 */
export function withSelfParticipant(
  participants: readonly MeetingParticipant[] | undefined,
  profileName: string,
): MeetingParticipant[] {
  const clean = sanitizeSpeakerName(profileName);
  const existing = findParticipant(participants, SELF_SPEAKER_ID);
  if (existing && existing.source !== "self") return [...(participants ?? [])];
  if (clean.length === 0) {
    return (participants ?? []).filter((p) => p.id !== SELF_SPEAKER_ID);
  }
  return upsertParticipant(participants, {
    id: SELF_SPEAKER_ID,
    name: clean,
    source: "self",
    confidence: 1,
  });
}

const PARTICIPANT_SOURCES: readonly ParticipantSource[] = [
  "self",
  "calendar",
  "context",
  "dictionary",
  "manual",
];

/** Validate participants coming off disk / IPC / the network. */
export function normalizeParticipants(raw: unknown): MeetingParticipant[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MeetingParticipant[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const p = entry as Partial<MeetingParticipant>;
    const id = typeof p.id === "string" ? p.id.trim().slice(0, 64) : "";
    const name = typeof p.name === "string" ? sanitizeSpeakerName(p.name) : "";
    if (id.length === 0 || name.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      ...(typeof p.email === "string" && p.email.length > 0
        ? { email: p.email.slice(0, 254) }
        : {}),
      source: PARTICIPANT_SOURCES.includes(p.source as ParticipantSource)
        ? (p.source as ParticipantSource)
        : "manual",
      confidence:
        typeof p.confidence === "number" &&
        p.confidence >= 0 &&
        p.confidence <= 1
          ? p.confidence
          : 1,
    });
  }
  return out;
}

/**
 * The labels a transcript actually uses, in first-spoken order, flagged for
 * whoever is the DoodleNote user — what the notes prompts need to attribute
 * decisions and action items to the right person.
 */
export function speakerInfos(
  segments: readonly TranscriptSegment[],
  participants?: readonly MeetingParticipant[],
): { label: string; isSelf: boolean }[] {
  const byLabel = new Map<string, { label: string; isSelf: boolean }>();
  for (const segment of segments) {
    const label = speakerLabel(segment, participants);
    const isSelf = speakerIdOf(segment) === SELF_SPEAKER_ID;
    const seen = byLabel.get(label);
    if (seen) seen.isSelf = seen.isSelf || isSelf;
    else byLabel.set(label, { label, isSelf });
  }
  return [...byLabel.values()];
}

/** Distinct speakers in a transcript, in first-spoken order. */
export function speakerIdsIn(
  segments: readonly Pick<TranscriptSegment, "channel" | "speakerId">[],
): string[] {
  const ids: string[] = [];
  for (const segment of segments) {
    const id = speakerIdOf(segment);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
