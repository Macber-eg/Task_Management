import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { projectAccessCondition } from "../../access/project-access-condition";
import { priorityRankSql } from "./board/task-sort";
import { taskIsCompletedSql } from "./task-is-completed";

// Home and My tasks render this list whole, so it stays one bounded page.
export const ASSIGNED_TASKS_LIMIT = 100;

const OPEN_AND_MINE = `p.workspace_id = $1
  AND p.archived_at IS NULL
  AND t.assignee_id = $2
  AND t.status <> 'archived'
  AND not coalesce((
    select c.is_final from "column" c
    where c.id = t.column_id and c.project_id = t.project_id
  ), ${taskIsCompletedSql("t")})
  AND ${projectAccessCondition("$2", "p.id")}`;

type AssignedTaskRow = { id: string } & Record<string, unknown>;
type LabelRow = {
  id: string;
  name: string;
  color: string;
  taskId: string | null;
};

/** The caller's open tasks across a workspace's active projects. */
@Injectable()
export class AssignedTasksService {
  constructor(private readonly dataSource: DataSource) {}

  async getAssignedTasks(
    workspaceId: string,
    userId: string,
    countOnly = false,
  ) {
    const parameters = [workspaceId, userId];
    const totals = this.dataSource.query(
      `SELECT count(*)::int AS total FROM task t
       INNER JOIN project p ON t.project_id = p.id
       WHERE ${OPEN_AND_MINE}`,
      parameters,
    ) as Promise<{ total: number }[]>;

    if (countOnly) {
      const [row] = await totals;
      return { tasks: [], total: Number(row?.total ?? 0) };
    }

    // Existing databases may contain duplicate slugs from concurrent column
    // creation. A lateral lookup must return at most one decoration per task.
    const [tasks, [total]] = await Promise.all([
      this.dataSource.query(
        `SELECT t.id, t.project_id AS "projectId", t.number, t.title, t.status,
           sc.name AS "statusName", sc.icon AS "statusIcon", t.priority,
           t.due_date AS "dueDate", p.name AS "projectName",
           p.slug AS "projectSlug", p.icon AS "projectIcon"
         FROM task t
         INNER JOIN project p ON t.project_id = p.id
         LEFT JOIN LATERAL (
           SELECT c.name, c.icon FROM "column" c
           WHERE c.project_id = t.project_id AND c.slug = t.status
           ORDER BY case when c.id = t.column_id then 0 else 1 end,
             c.position ASC, c.created_at ASC, c.id ASC
           LIMIT 1
         ) sc ON true
         WHERE ${OPEN_AND_MINE}
         ORDER BY t.due_date asc nulls last, ${priorityRankSql("t")} DESC,
           t.created_at ASC, t.id ASC
         LIMIT ${ASSIGNED_TASKS_LIMIT}`,
        parameters,
      ) as Promise<AssignedTaskRow[]>,
      totals,
    ]);

    const labels = tasks.length
      ? ((await this.dataSource.query(
          `SELECT id, name, color, task_id AS "taskId" FROM label
           WHERE task_id = ANY($1::text[]) ORDER BY name ASC, id ASC`,
          [tasks.map((task) => task.id)],
        )) as LabelRow[])
      : [];

    const labelsByTask = new Map<string, Omit<LabelRow, "taskId">[]>();
    for (const { taskId, ...label } of labels) {
      if (!taskId) continue;
      const taskLabels = labelsByTask.get(taskId) ?? [];
      taskLabels.push(label);
      labelsByTask.set(taskId, taskLabels);
    }

    return {
      tasks: tasks.map((task) => ({
        ...task,
        labels: labelsByTask.get(task.id) ?? [],
      })),
      total: Number(total?.total ?? 0),
    };
  }
}
