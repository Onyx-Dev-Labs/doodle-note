import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as authSchema from "../src/auth-schema";
import * as schema from "../src/schema";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  // In-memory PGlite — nothing touches disk.
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: path.join(packageRoot, "drizzle") });

  // Meetings hang off a Better Auth organization + user now.
  await db.insert(authSchema.user).values({
    id: "user_smoke",
    name: "Smoke Tester",
    email: "smoke@example.com",
    updatedAt: new Date(),
  });
  await db.insert(authSchema.organization).values({
    id: "org_smoke",
    name: "Personal",
    slug: "personal-smoke",
    createdAt: new Date(),
  });

  const [meeting] = await db
    .insert(schema.meetings)
    .values({
      id: "3b4c1a52-90cd-4f6e-b8b3-2a4f0f6f9d01",
      organizationId: "org_smoke",
      title: "Weekly sync",
      status: "complete",
    })
    .returning();
  if (!meeting) throw new Error("meeting insert returned no row");

  await db.insert(schema.transcriptSegments).values([
    {
      meetingId: meeting.id,
      channel: "mic",
      speaker: "You",
      text: "Let's walk through the launch checklist.",
      startMs: 0,
      endMs: 3200,
      confidence: 0.97,
    },
    {
      meetingId: meeting.id,
      channel: "system",
      speaker: "Them",
      text: "Sounds good — starting with the beta signups.",
      startMs: 3200,
      endMs: 7400,
      confidence: 0.94,
    },
  ]);

  await db.insert(schema.notes).values({
    meetingId: meeting.id,
    rawContent: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "launch checklist, beta signups" }],
        },
      ],
    },
  });

  await db
    .update(schema.meetings)
    .set({
      shareToken: "0123456789abcdef0123456789abcdef",
      shareExpiresAt: new Date("2030-01-01T00:00:00Z"),
      shareIncludeTranscript: false,
    })
    .where(eq(schema.meetings.id, meeting.id));
  await db.insert(schema.meetingStars).values({
    meetingId: meeting.id,
    userId: "user_smoke",
  });
  const [tag] = await db
    .insert(schema.meetingTags)
    .values({ organizationId: "org_smoke", name: "launch" })
    .returning();
  if (!tag) throw new Error("tag insert returned no row");
  await db.insert(schema.meetingTagLinks).values({
    meetingId: meeting.id,
    tagId: tag.id,
  });

  const rows = await db
    .select({
      meetingTitle: schema.meetings.title,
      meetingStatus: schema.meetings.status,
      speaker: schema.transcriptSegments.speaker,
      segmentText: schema.transcriptSegments.text,
      startMs: schema.transcriptSegments.startMs,
      rawNotes: schema.notes.rawContent,
    })
    .from(schema.meetings)
    .innerJoin(
      schema.transcriptSegments,
      eq(schema.transcriptSegments.meetingId, schema.meetings.id),
    )
    .innerJoin(schema.notes, eq(schema.notes.meetingId, schema.meetings.id))
    .where(eq(schema.meetings.id, meeting.id))
    .orderBy(asc(schema.transcriptSegments.startMs));

  const first = rows[0];
  if (rows.length !== 2 || !first || first.rawNotes == null) {
    throw new Error(`unexpected join result: ${JSON.stringify(rows)}`);
  }

  const [controls] = await db
    .select({
      shareToken: schema.meetings.shareToken,
      includeTranscript: schema.meetings.shareIncludeTranscript,
      starredBy: schema.meetingStars.userId,
      tag: schema.meetingTags.name,
    })
    .from(schema.meetings)
    .innerJoin(
      schema.meetingStars,
      eq(schema.meetingStars.meetingId, schema.meetings.id),
    )
    .innerJoin(
      schema.meetingTagLinks,
      eq(schema.meetingTagLinks.meetingId, schema.meetings.id),
    )
    .innerJoin(
      schema.meetingTags,
      eq(schema.meetingTags.id, schema.meetingTagLinks.tagId),
    )
    .where(eq(schema.meetings.id, meeting.id));
  if (
    controls?.shareToken !== "0123456789abcdef0123456789abcdef" ||
    controls.includeTranscript !== false ||
    controls.starredBy !== "user_smoke" ||
    controls.tag !== "launch"
  ) {
    throw new Error(`unexpected cloud controls: ${JSON.stringify(controls)}`);
  }

  console.log(
    `smoke OK: meeting "${first.meetingTitle}" (${first.meetingStatus}) round-tripped ${rows.length} transcript segments + notes, secure sharing, a star, and a tag through in-memory PGlite`,
  );

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
