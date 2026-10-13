import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  taskEstimateAllocationTable,
  taskTable,
  timeEntryTable,
  userTable,
  workspaceMemberCapacityTable,
  workspaceUserTable,
} from "../../database/schema";
import { summarizeEffort } from "../metrics";

type WorkloadFilters = {
  workspaceId: string;
  projectId?: string;
  userId?: string;
  from: Date;
  to: Date;
};

function workingDaysBetween(from: Date, to: Date): number {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  if (end < start) return 0;
  let days = 0;
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days;
}

async function getWorkloadReport(filters: WorkloadFilters) {
  const memberConditions = [
    eq(workspaceUserTable.workspaceId, filters.workspaceId),
  ];
  if (filters.userId) {
    memberConditions.push(eq(workspaceUserTable.userId, filters.userId));
  }

  const members = await db
    .select({
      userId: workspaceUserTable.userId,
      userName: userTable.name,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .where(and(...memberConditions));

  if (members.length === 0) {
    throw new HTTPException(404, { message: "No workspace members found" });
  }

  const memberIds = members.map((member) => member.userId);

  const capacities = await db
    .select()
    .from(workspaceMemberCapacityTable)
    .where(
      and(
        eq(workspaceMemberCapacityTable.workspaceId, filters.workspaceId),
        inArray(workspaceMemberCapacityTable.userId, memberIds),
      ),
    );

  const capacityByUser = new Map(capacities.map((row) => [row.userId, row]));

  const workingDays = workingDaysBetween(filters.from, filters.to);

  const allocationConditions = [
    inArray(taskEstimateAllocationTable.userId, memberIds),
  ];
  if (filters.projectId) {
    allocationConditions.push(eq(taskTable.projectId, filters.projectId));
  }

  const allocationRows = await db
    .select({
      userId: taskEstimateAllocationTable.userId,
      estimatedMinutes: taskEstimateAllocationTable.estimatedMinutes,
    })
    .from(taskEstimateAllocationTable)
    .innerJoin(taskTable, eq(taskEstimateAllocationTable.taskId, taskTable.id))
    .where(and(...allocationConditions));

  const plannedByUser = new Map<string, number>();
  for (const row of allocationRows) {
    plannedByUser.set(
      row.userId,
      (plannedByUser.get(row.userId) ?? 0) + row.estimatedMinutes,
    );
  }

  const actualConditions = [
    inArray(timeEntryTable.userId, memberIds),
    gte(timeEntryTable.startTime, filters.from),
    lte(timeEntryTable.startTime, filters.to),
    sql`${timeEntryTable.endTime} is not null`,
  ];
  if (filters.projectId) {
    actualConditions.push(eq(taskTable.projectId, filters.projectId));
  }

  const actualRows = await db
    .select({
      userId: timeEntryTable.userId,
      seconds: sql<number>`coalesce(sum(${timeEntryTable.duration}), 0)`,
    })
    .from(timeEntryTable)
    .innerJoin(taskTable, eq(timeEntryTable.taskId, taskTable.id))
    .where(and(...actualConditions))
    .groupBy(timeEntryTable.userId);

  const actualByUser = new Map<string, number>();
  for (const row of actualRows) {
    if (row.userId) actualByUser.set(row.userId, Number(row.seconds) || 0);
  }

  return members.map((member) => {
    const capacity = capacityByUser.get(member.userId);
    const minutesPerDay = capacity?.minutesPerDay ?? 480;
    const weeklyCapacityMinutes =
      (capacity?.workingDaysPerWeek ?? 5) * minutesPerDay;
    const rangeCapacityMinutes = Math.round(
      (workingDays / 5) * weeklyCapacityMinutes,
    );
    const plannedMinutes = plannedByUser.get(member.userId) ?? 0;
    const actualSeconds = actualByUser.get(member.userId) ?? 0;
    const workloadPercent =
      rangeCapacityMinutes > 0
        ? (plannedMinutes / rangeCapacityMinutes) * 100
        : null;
    const overloadedMinutes = Math.max(
      0,
      plannedMinutes - rangeCapacityMinutes,
    );
    const availableMinutes = Math.max(0, rangeCapacityMinutes - plannedMinutes);
    const effort = summarizeEffort(plannedMinutes, actualSeconds);
    return {
      userId: member.userId,
      userName: member.userName,
      rangeCapacityMinutes,
      plannedMinutes,
      actualSeconds,
      workloadPercent,
      overloadedMinutes,
      availableMinutes,
      overEstimate: effort.overEstimate,
      utilizationPercent: effort.utilizationPercent,
    };
  });
}

export default getWorkloadReport;
