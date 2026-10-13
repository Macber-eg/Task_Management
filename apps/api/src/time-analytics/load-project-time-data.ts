import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import db from "../database";
import {
  projectPhaseTable,
  projectSprintTable,
  projectTable,
  taskEstimateAllocationTable,
  taskRelationTable,
  taskTable,
  timeEntryTable,
  userTable,
} from "../database/schema";
import { alias } from "drizzle-orm/pg-core";

const phaseAlias = alias(projectPhaseTable, "timesheet_phase");
const sprintAlias = alias(projectSprintTable, "timesheet_sprint");

export type ProjectTaskRow = {
  id: string;
  title: string;
  number: number | null;
  status: string;
  phaseId: string | null;
  sprintId: string | null;
  estimatedMinutes: number | null;
  userId: string | null;
};

export async function loadProjectTimeData(projectId: string) {
  const [project] = await db
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      name: projectTable.name,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  if (!project) return null;

  const tasks = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      status: taskTable.status,
      phaseId: taskTable.phaseId,
      sprintId: taskTable.sprintId,
      estimatedMinutes: taskTable.estimatedMinutes,
      userId: taskTable.userId,
    })
    .from(taskTable)
    .where(eq(taskTable.projectId, projectId));

  const taskIds = tasks.map((task) => task.id);
  const relations =
    taskIds.length > 0
      ? await db
          .select({
            parentId: taskRelationTable.sourceTaskId,
            childId: taskRelationTable.targetTaskId,
          })
          .from(taskRelationTable)
          .where(
            and(
              eq(taskRelationTable.relationType, "subtask"),
              inArray(taskRelationTable.sourceTaskId, taskIds),
              inArray(taskRelationTable.targetTaskId, taskIds),
            ),
          )
      : [];

  const subtasksByParentId = new Map<string, string[]>();
  for (const relation of relations) {
    const list = subtasksByParentId.get(relation.parentId) ?? [];
    list.push(relation.childId);
    subtasksByParentId.set(relation.parentId, list);
  }

  const actualRows =
    taskIds.length > 0
      ? await db
          .select({
            taskId: timeEntryTable.taskId,
            totalSeconds: sql<number>`coalesce(sum(${timeEntryTable.duration}), 0)`,
          })
          .from(timeEntryTable)
          .where(
            and(
              inArray(timeEntryTable.taskId, taskIds),
              sql`${timeEntryTable.endTime} is not null`,
            ),
          )
          .groupBy(timeEntryTable.taskId)
      : [];

  const actualByTaskId = new Map<string, number>();
  for (const row of actualRows) {
    actualByTaskId.set(row.taskId, Number(row.totalSeconds) || 0);
  }

  const estimatedByTaskId = new Map<string, number | null>();
  for (const task of tasks) {
    estimatedByTaskId.set(task.id, task.estimatedMinutes);
  }

  const phases = await db
    .select()
    .from(projectPhaseTable)
    .where(eq(projectPhaseTable.projectId, projectId));

  const sprints = await db
    .select()
    .from(projectSprintTable)
    .where(eq(projectSprintTable.projectId, projectId));

  return {
    project,
    tasks,
    phases,
    sprints,
    subtasksByParentId,
    actualByTaskId,
    estimatedByTaskId,
  };
}

export type TimesheetFilters = {
  workspaceId: string;
  projectId?: string;
  phaseId?: string;
  sprintId?: string;
  taskId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
};

export async function loadTimesheetRows(filters: TimesheetFilters) {
  const conditions = [eq(projectTable.workspaceId, filters.workspaceId)];

  if (filters.projectId) {
    conditions.push(eq(taskTable.projectId, filters.projectId));
  }
  if (filters.phaseId) {
    conditions.push(eq(taskTable.phaseId, filters.phaseId));
  }
  if (filters.sprintId) {
    conditions.push(eq(taskTable.sprintId, filters.sprintId));
  }
  if (filters.taskId) {
    conditions.push(eq(timeEntryTable.taskId, filters.taskId));
  }
  if (filters.userId) {
    conditions.push(eq(timeEntryTable.userId, filters.userId));
  }
  if (filters.from) {
    conditions.push(gte(timeEntryTable.startTime, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(timeEntryTable.startTime, filters.to));
  }

  return db
    .select({
      id: timeEntryTable.id,
      taskId: timeEntryTable.taskId,
      userId: timeEntryTable.userId,
      userName: userTable.name,
      description: timeEntryTable.description,
      startTime: timeEntryTable.startTime,
      endTime: timeEntryTable.endTime,
      duration: timeEntryTable.duration,
      createdAt: timeEntryTable.createdAt,
      updatedAt: timeEntryTable.updatedAt,
      taskTitle: taskTable.title,
      taskNumber: taskTable.number,
      taskEstimatedMinutes: taskTable.estimatedMinutes,
      projectId: taskTable.projectId,
      projectName: projectTable.name,
      phaseId: taskTable.phaseId,
      phaseName: phaseAlias.name,
      sprintId: taskTable.sprintId,
      sprintName: sprintAlias.name,
      userAllocatedMinutes: taskEstimateAllocationTable.estimatedMinutes,
    })
    .from(timeEntryTable)
    .innerJoin(taskTable, eq(timeEntryTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(userTable, eq(timeEntryTable.userId, userTable.id))
    .leftJoin(phaseAlias, eq(taskTable.phaseId, phaseAlias.id))
    .leftJoin(sprintAlias, eq(taskTable.sprintId, sprintAlias.id))
    .leftJoin(
      taskEstimateAllocationTable,
      and(
        eq(taskEstimateAllocationTable.taskId, taskTable.id),
        eq(taskEstimateAllocationTable.userId, timeEntryTable.userId),
      ),
    )
    .where(and(...conditions, sql`${timeEntryTable.endTime} is not null`))
    .orderBy(timeEntryTable.startTime);
}
