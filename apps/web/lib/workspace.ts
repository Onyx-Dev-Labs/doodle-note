import { randomUUID } from "node:crypto";

import { and, eq, getDb, member, organization, sql } from "@repo/db";

/**
 * Every user gets a "Personal" workspace so the app never opens empty.
 * Idempotent: returns the user's dedicated Personal workspace if it exists.
 * A team workspace must never accidentally become the user's private default.
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
    .where(
      and(
        eq(member.userId, userId),
        sql`${organization.slug} like 'personal-%'`,
      ),
    )
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
