import { randomUUID } from "node:crypto";

import { eq, getDb, member, organization } from "@repo/db";

/**
 * Every user gets a "Personal" workspace so the app never opens empty.
 * Idempotent: returns the user's first workspace if one already exists.
 */
export async function ensurePersonalWorkspace(
  userId: string,
): Promise<{ id: string; name: string; slug: string }> {
  const db = getDb();

  const existing = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];

  const orgId = randomUUID();
  const slug = `personal-${orgId.slice(0, 8)}`;
  const now = new Date();
  await db.insert(organization).values({
    id: orgId,
    name: "Personal",
    slug,
    createdAt: now,
  });
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: orgId,
    userId,
    role: "owner",
    createdAt: now,
  });
  return { id: orgId, name: "Personal", slug };
}
