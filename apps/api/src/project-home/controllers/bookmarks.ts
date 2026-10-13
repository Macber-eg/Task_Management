import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectBookmarkTable } from "../../database/schema";

export async function listProjectBookmarks(projectId: string, userId: string) {
  return db
    .select()
    .from(projectBookmarkTable)
    .where(
      and(
        eq(projectBookmarkTable.projectId, projectId),
        eq(projectBookmarkTable.userId, userId),
      ),
    )
    .orderBy(desc(projectBookmarkTable.updatedAt));
}

export async function createProjectBookmark(
  projectId: string,
  userId: string,
  title: string,
  url: string,
) {
  const [row] = await db
    .insert(projectBookmarkTable)
    .values({
      id: createId(),
      projectId,
      userId,
      title: title.trim(),
      url: url.trim(),
    })
    .returning();
  return row;
}

export async function updateProjectBookmark(
  id: string,
  userId: string,
  title: string,
  url: string,
) {
  const [row] = await db
    .update(projectBookmarkTable)
    .set({ title: title.trim(), url: url.trim() })
    .where(
      and(
        eq(projectBookmarkTable.id, id),
        eq(projectBookmarkTable.userId, userId),
      ),
    )
    .returning();
  if (!row) {
    throw new HTTPException(404, { message: "Bookmark not found" });
  }
  return row;
}

export async function deleteProjectBookmark(id: string, userId: string) {
  const [row] = await db
    .delete(projectBookmarkTable)
    .where(
      and(
        eq(projectBookmarkTable.id, id),
        eq(projectBookmarkTable.userId, userId),
      ),
    )
    .returning();
  if (!row) {
    throw new HTTPException(404, { message: "Bookmark not found" });
  }
  return row;
}
