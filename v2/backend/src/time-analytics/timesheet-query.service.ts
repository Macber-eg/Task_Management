import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

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

@Injectable()
export class TimesheetQueryService {
  constructor(private readonly dataSource: DataSource) {}

  /** Closed time entries in a workspace with task, project and planning context. */
  loadTimesheetRows(
    filters: TimesheetFilters,
  ): Promise<Record<string, unknown>[]> {
    const parameters: unknown[] = [filters.workspaceId];
    const conditions = ["p.workspace_id = $1"];
    const add = (sql: string, value: unknown) => {
      parameters.push(value);
      conditions.push(sql.replace("?", `$${parameters.length}`));
    };

    if (filters.projectId) add("t.project_id = ?", filters.projectId);
    if (filters.phaseId) add("t.phase_id = ?", filters.phaseId);
    if (filters.sprintId) add("t.sprint_id = ?", filters.sprintId);
    if (filters.taskId) add("te.task_id = ?", filters.taskId);
    if (filters.userId) add("te.user_id = ?", filters.userId);
    if (filters.from) add("te.start_time >= ?", filters.from);
    if (filters.to) add("te.start_time <= ?", filters.to);

    return this.dataSource.query(
      `SELECT te.id, te.task_id AS "taskId", te.user_id AS "userId",
         u.name AS "userName", te.description, te.start_time AS "startTime",
         te.end_time AS "endTime", te.duration, te.created_at AS "createdAt",
         te.updated_at AS "updatedAt", t.title AS "taskTitle",
         t.number AS "taskNumber", t.estimated_minutes AS "taskEstimatedMinutes",
         t.project_id AS "projectId", p.name AS "projectName",
         t.phase_id AS "phaseId", timesheet_phase.name AS "phaseName",
         t.sprint_id AS "sprintId", timesheet_sprint.name AS "sprintName",
         allocation.estimated_minutes AS "userAllocatedMinutes"
       FROM time_entry AS te
       INNER JOIN task AS t ON te.task_id = t.id
       INNER JOIN project AS p ON t.project_id = p.id
       LEFT JOIN "user" AS u ON te.user_id = u.id
       LEFT JOIN project_phase AS timesheet_phase ON t.phase_id = timesheet_phase.id
       LEFT JOIN project_sprint AS timesheet_sprint ON t.sprint_id = timesheet_sprint.id
       LEFT JOIN task_estimate_allocation AS allocation
         ON allocation.task_id = t.id AND allocation.user_id = te.user_id
       WHERE ${conditions.join(" AND ")} AND te.end_time IS NOT NULL
       ORDER BY te.start_time`,
      parameters,
    );
  }
}
