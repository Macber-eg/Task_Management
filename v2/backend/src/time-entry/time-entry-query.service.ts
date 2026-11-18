import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TimeEntryEntity } from "../database/entities/time-entry.entity";

const TIME_ENTRY_COLUMNS = `te.id, te.task_id AS "taskId", te.user_id AS "userId",
  te.description, te.start_time AS "startTime", te.end_time AS "endTime",
  te.duration, te.created_at AS "createdAt", te.updated_at AS "updatedAt"`;

@Injectable()
export class TimeEntryQueryService {
  constructor(private readonly dataSource: DataSource) {}

  /** The user's running entry with its task and project, or null. */
  async getActiveTimeEntry(userId: string) {
    const [row] = (await this.dataSource.query(
      `SELECT ${TIME_ENTRY_COLUMNS},
         t.title AS "taskTitle", t.number AS "taskNumber",
         t.project_id AS "projectId", p.workspace_id AS "workspaceId",
         p.slug AS "projectSlug"
       FROM time_entry AS te
       INNER JOIN task AS t ON te.task_id = t.id
       INNER JOIN project AS p ON t.project_id = p.id
       WHERE te.user_id = $1 AND te.end_time IS NULL
       LIMIT 1`,
      [userId],
    )) as Record<string, unknown>[];

    return row ?? null;
  }

  getTimeEntriesByTaskId(taskId: string) {
    return this.dataSource.query(
      `SELECT te.id, te.task_id AS "taskId", te.user_id AS "userId",
         u.name AS "userName", te.description, te.start_time AS "startTime",
         te.end_time AS "endTime", te.duration, te.created_at AS "createdAt",
         te.updated_at AS "updatedAt"
       FROM time_entry AS te
       LEFT JOIN "user" AS u ON te.user_id = u.id
       WHERE te.task_id = $1
       ORDER BY te.start_time`,
      [taskId],
    ) as Promise<Record<string, unknown>[]>;
  }

  getTimeEntry(id: string) {
    return this.dataSource.manager.findOne(TimeEntryEntity, { where: { id } });
  }
}
