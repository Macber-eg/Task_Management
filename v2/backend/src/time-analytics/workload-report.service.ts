import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { WorkspaceMemberCapacityEntity } from "../database/entities/workspace-member-capacity.entity";
import { summarizeEffort } from "./metrics";
import { workingDaysBetween } from "./working-days-between";

type WorkloadFilters = {
  workspaceId: string;
  projectId?: string;
  userId?: string;
  from: Date;
  to: Date;
};

@Injectable()
export class WorkloadReportService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Per member: capacity over the range's working days, planned minutes from
   * estimate allocations, and seconds logged on closed entries in the range.
   */
  async getWorkloadReport(filters: WorkloadFilters) {
    const manager = this.dataSource.manager;
    const memberParameters: unknown[] = [filters.workspaceId];
    if (filters.userId) memberParameters.push(filters.userId);

    const members = (await manager.query(
      `SELECT wm.user_id AS "userId", u.name AS "userName"
       FROM workspace_member AS wm
       INNER JOIN "user" AS u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1 ${filters.userId ? "AND wm.user_id = $2" : ""}`,
      memberParameters,
    )) as { userId: string; userName: string }[];

    if (members.length === 0) {
      throw new HTTPException(404, { message: "No workspace members found" });
    }

    const memberIds = members.map((member) => member.userId);

    const capacities = await manager.find(WorkspaceMemberCapacityEntity, {
      where: { workspaceId: filters.workspaceId, userId: In(memberIds) },
    });

    const capacityByUser = new Map(capacities.map((row) => [row.userId, row]));

    const workingDays = workingDaysBetween(filters.from, filters.to);

    const allocationParameters: unknown[] = [memberIds];
    if (filters.projectId) allocationParameters.push(filters.projectId);
    const allocationRows = (await manager.query(
      `SELECT allocation.user_id AS "userId",
         allocation.estimated_minutes AS "estimatedMinutes"
       FROM task_estimate_allocation AS allocation
       INNER JOIN task AS t ON allocation.task_id = t.id
       WHERE allocation.user_id = ANY($1::text[])
         ${filters.projectId ? "AND t.project_id = $2" : ""}`,
      allocationParameters,
    )) as { userId: string; estimatedMinutes: number }[];

    const plannedByUser = new Map<string, number>();
    for (const row of allocationRows) {
      plannedByUser.set(
        row.userId,
        (plannedByUser.get(row.userId) ?? 0) + row.estimatedMinutes,
      );
    }

    const actualParameters: unknown[] = [memberIds, filters.from, filters.to];
    if (filters.projectId) actualParameters.push(filters.projectId);
    const actualRows = (await manager.query(
      `SELECT te.user_id AS "userId", coalesce(sum(te.duration), 0) AS seconds
       FROM time_entry AS te
       INNER JOIN task AS t ON te.task_id = t.id
       WHERE te.user_id = ANY($1::text[])
         AND te.start_time >= $2
         AND te.start_time <= $3
         AND te.end_time is not null
         ${filters.projectId ? "AND t.project_id = $4" : ""}
       GROUP BY te.user_id`,
      actualParameters,
    )) as { userId: string | null; seconds: string | number }[];

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
      const availableMinutes = Math.max(
        0,
        rangeCapacityMinutes - plannedMinutes,
      );
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
}
