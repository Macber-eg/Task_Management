import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { projectRecentAccessTable } from "../../database/schema";

const MAX_RECENT = 30;

export async function listProjectRecent(projectId: string, userId: string) {
  return db
    .select()
    .from(projectRecentAccessTable)
    .where(
      and(
        eq(projectRecentAccessTable.projectId, projectId),
        eq(projectRecentAccessTable.userId, userId),
      ),
    )
    .orderBy(desc(projectRecentAccessTable.accessedAt))
    .limit(12);
}

export async function recordProjectRecent(
  projectId: string,
  userId: string,
  body: {
    itemType: string;
    itemId: string;
    title: string;
    parentLabel?: string | null;
  },
) {
  const now = new Date();
  await db
    .insert(projectRecentAccessTable)
    .values({
      id: createId(),
      projectId,
      userId,
      itemType: body.itemType,
      itemId: body.itemId,
      title: body.title.trim(),
      parentLabel: body.parentLabel?.trim() || null,
      accessedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        projectRecentAccessTable.projectId,
        projectRecentAccessTable.userId,
        projectRecentAccessTable.itemType,
        projectRecentAccessTable.itemId,
      ],
      set: {
        title: body.title.trim(),
        parentLabel: body.parentLabel?.trim() || null,
        accessedAt: now,
      },
    });

  const rows = await db
    .select({ id: projectRecentAccessTable.id })
    .from(projectRecentAccessTable)
    .where(
      and(
        eq(projectRecentAccessTable.projectId, projectId),
        eq(projectRecentAccessTable.userId, userId),
      ),
    )
    .orderBy(desc(projectRecentAccessTable.accessedAt));

  if (rows.length > MAX_RECENT) {
    const staleIds = rows.slice(MAX_RECENT).map((row) => row.id);
    await db
      .delete(projectRecentAccessTable)
      .where(inArray(projectRecentAccessTable.id, staleIds));
  }

  return listProjectRecent(projectId, userId);
}
