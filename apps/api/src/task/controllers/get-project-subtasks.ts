import { and, eq } from "drizzle-orm";
import db from "../../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";

export type SubtaskSummary = {
  id: string;
  title: string;
  number: number | null;
  status: string;
};

async function getProjectSubtasks(projectId: string) {
  const rows = await db
    .select({
      parentId: taskRelationTable.sourceTaskId,
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      status: taskTable.status,
    })
    .from(taskRelationTable)
    .innerJoin(taskTable, eq(taskRelationTable.targetTaskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskRelationTable.relationType, "subtask"),
        eq(taskTable.projectId, projectId),
      ),
    );

  const byParent: Record<string, SubtaskSummary[]> = {};
  for (const row of rows) {
    const bucket = byParent[row.parentId] ?? [];
    if (!byParent[row.parentId]) byParent[row.parentId] = bucket;
    bucket.push({
      id: row.id,
      title: row.title,
      number: row.number,
      status: row.status,
    });
  }

  for (const key of Object.keys(byParent)) {
    byParent[key]?.sort(
      (a, b) =>
        (a.number ?? 0) - (b.number ?? 0) || a.title.localeCompare(b.title),
    );
  }

  return { byParent };
}

export default getProjectSubtasks;
