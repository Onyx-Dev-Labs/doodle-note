import { bigint, boolean, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organization, user } from "./auth-schema";

export const folders = pgTable(
  "folders",
  {
    /** Desktop-minted UUID — the same id on every device and in the cloud. */
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("folders_organization_id_idx").on(table.organizationId)],
);

export const meetings = pgTable(
  "meetings",
  {
    /** Desktop-minted UUID — the same id on the Mac and in the cloud. */
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled meeting"),
    /** "meeting" or standalone quick "note" (desktop's kind field). */
    kind: text("kind", { enum: ["meeting", "note"] })
      .notNull()
      .default("meeting"),
    status: text("status", { enum: ["recording", "processing", "complete"] })
      .notNull()
      .default("complete"),
    calendarEventId: text("calendar_event_id"),
    /** Optional folder assignment; folder deletion moves meetings out. */
    folderId: uuid("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    /** Public share-link token; null = not shared. */
    shareToken: text("share_token").unique(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("meetings_organization_id_idx").on(table.organizationId)],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["mic", "system"] }).notNull(),
    speaker: text("speaker").notNull(),
    text: text("text").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    /** Wall-clock epoch ms of the segment start — the audio-playback seek
     *  anchor. bigint: epoch ms overflows int4. Null on segments recorded
     *  before this column existed (or from clients that don't send it). */
    absoluteStartMs: bigint("absolute_start_ms", { mode: "number" }),
    confidence: real("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("transcript_segments_meeting_id_idx").on(table.meetingId),
  ],
);

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  meetingId: uuid("meeting_id")
    .notNull()
    .unique()
    .references(() => meetings.id, { onDelete: "cascade" }),
  /** The user's rough notes — { format: "markdown", markdown } for now. */
  rawContent: jsonb("raw_content"),
  /** AI-merged notes, same envelope. */
  enhancedContent: jsonb("enhanced_content"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/**
 * A linked desktop app. The plaintext token is shown once during the
 * link-device flow and held by the desktop (safeStorage-encrypted); only its
 * SHA-256 lives here. Sync requests authenticate with `Authorization: Bearer`.
 */
export const syncDevices = pgTable(
  "sync_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    deviceName: text("device_name").notNull().default("Desktop"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => [index("sync_devices_user_id_idx").on(table.userId)],
);

/**
 * A revocable, READ-ONLY token for remote AI agents (the hosted MCP at
 * /api/mcp). Same trust model as sync_devices: the plaintext `dnag_…` token
 * is shown once at mint time and only its SHA-256 lives here. Deleting the
 * row revokes access immediately.
 */
export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [index("agent_tokens_user_id_idx").on(table.userId)],
);

/**
 * Per-user cloud-sync billing. A user syncs when grandfathered (had a
 * linked device before billing launched) or their Stripe subscription is
 * trialing/active. No row = never subscribed.
 */
export const subscriptions = pgTable("subscriptions", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  /** Stripe subscription status (trialing/active/past_due/canceled/...). */
  status: text("status").notNull().default("none"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  grandfathered: boolean("grandfathered").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/**
 * Verified Caller ID for phone calls: a user proves ownership of their real
 * number via Twilio's validation flow, and outbound DoodleNote calls then
 * display it instead of the shared workspace number.
 */
export const verifiedCallerIds = pgTable("verified_caller_ids", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** E.164, e.g. +16145551234. */
  phoneNumber: text("phone_number").notNull(),
  /** "pending" until Twilio confirms the validation call; then "verified". */
  status: text("status").notNull().default("pending"),
  /** Twilio OutgoingCallerId SID once verified. */
  outgoingCallerIdSid: text("outgoing_caller_id_sid"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
