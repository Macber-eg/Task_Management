import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

export type SubtaskSummary = {
  id: string;
  title: string;
  number: number | null;
  status: string;
};

/** A project's subtasks, grouped by their parent task id. */
@Injectable()
export class ProjectSubtasksService {
  constructor(private readonly dataSource: DataSource) {}

  async getProjectSubtasks(projectId: string) {
    const rows = (await this.dataSource.query(
      `SELECT r.source_task_id AS "parentId", t.id, t.title, t.number, t.status
       FROM task_relation r
       INNER JOIN task t ON r.target_task_id = t.id
       INNER JOIN project p ON t.project_id = p.id
       WHERE r.relation_type = 'subtask' AND t.project_id = $1`,
      [projectId],
    )) as (SubtaskSummary & { parentId: string })[];

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
}
