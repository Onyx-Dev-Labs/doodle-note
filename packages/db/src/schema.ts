import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const meetings = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id),
  title: text("title").notNull().default("Untitled meeting"),
  status: text("status", { enum: ["recording", "processing", "complete"] })
    .notNull()
    .default("recording"),
  calendarEventId: text("calendar_event_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

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
  /** ProseMirror doc — the user's rough notes. */
  rawContent: jsonb("raw_content"),
  /** AI-merged notes. */
  enhancedContent: jsonb("enhanced_content"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
