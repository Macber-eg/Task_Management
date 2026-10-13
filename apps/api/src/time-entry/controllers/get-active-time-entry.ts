import { and, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { projectTable, taskTable, timeEntryTable } from "../../database/schema";

async function getActiveTimeEntry(userId: string) {
  const [row] = await db
    .select({
      id: timeEntryTable.id,
      taskId: timeEntryTable.taskId,
      userId: timeEntryTable.userId,
      description: timeEntryTable.description,
      startTime: timeEntryTable.startTime,
      endTime: timeEntryTable.endTime,
      duration: timeEntryTable.duration,
      createdAt: timeEntryTable.createdAt,
      updatedAt: timeEntryTable.updatedAt,
      taskTitle: taskTable.title,
      taskNumber: taskTable.number,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
      projectSlug: projectTable.slug,
    })
    .from(timeEntryTable)
    .innerJoin(taskTable, eq(timeEntryTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(eq(timeEntryTable.userId, userId), isNull(timeEntryTable.endTime)),
    )
    .limit(1);

  return row ?? null;
}

export default getActiveTimeEntry;
