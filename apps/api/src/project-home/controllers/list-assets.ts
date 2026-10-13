import { desc, eq } from "drizzle-orm";
import db from "../../database";
import { assetTable } from "../../database/schema";

export async function listProjectAssets(projectId: string, limit = 20) {
  return db
    .select({
      id: assetTable.id,
      filename: assetTable.filename,
      mimeType: assetTable.mimeType,
      size: assetTable.size,
      kind: assetTable.kind,
      taskId: assetTable.taskId,
      createdAt: assetTable.createdAt,
    })
    .from(assetTable)
    .where(eq(assetTable.projectId, projectId))
    .orderBy(desc(assetTable.createdAt))
    .limit(limit);
}
