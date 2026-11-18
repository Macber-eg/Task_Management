import type { EntityManager } from "typeorm";
import {
  getInitials,
  resolveColumnIcon,
  resolveDueStatus,
  resolveLabelColor,
  resolvePriority,
} from "./email-task-format";
import type { NotificationEmailTask } from "./notification-email";

type TaskRow = {
  number: number | null;
  title: string;
  priority: string | null;
  dueDate: Date | null;
  status: string;
  columnId: string | null;
  projectId: string;
  projectSlug: string;
  assigneeName: string | null;
};

type ColumnRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  isFinal: boolean;
};

async function findColumn(manager: EntityManager, task: TaskRow) {
  const [column] = (await (task.columnId
    ? manager.query(
        `SELECT id, name, slug, icon, is_final AS "isFinal"
         FROM "column" WHERE id = $1 LIMIT 1`,
        [task.columnId],
      )
    : manager.query(
        `SELECT id, name, slug, icon, is_final AS "isFinal"
         FROM "column" WHERE project_id = $1 AND slug = $2 LIMIT 1`,
        [task.projectId, task.status],
      ))) as ColumnRow[];
  return column;
}

/** The task card shown in a notification email, as the board shows it. */
export async function resolveEmailTask(
  manager: EntityManager,
  taskId: string,
): Promise<NotificationEmailTask | undefined> {
  const [task] = (await manager.query(
    `SELECT t.number, t.title, t.priority, t.due_date AS "dueDate", t.status,
       t.column_id AS "columnId", t.project_id AS "projectId",
       p.slug AS "projectSlug", u.name AS "assigneeName"
     FROM task AS t
     INNER JOIN project AS p ON t.project_id = p.id
     LEFT JOIN "user" AS u ON t.assignee_id = u.id
     WHERE t.id = $1
     LIMIT 1`,
    [taskId],
  )) as TaskRow[];

  if (!task) {
    return undefined;
  }

  const [column, labels] = await Promise.all([
    findColumn(manager, task),
    manager.query(
      `SELECT name, color FROM label
       WHERE task_id = $1 AND deletion_started_at IS NULL
       ORDER BY created_at ASC`,
      [taskId],
    ) as Promise<{ name: string; color: string }[]>,
  ]);

  const [columnCount] = column
    ? ((await manager.query(
        `SELECT count(*)::int AS value FROM task
         WHERE project_id = $1 AND status = $2`,
        [task.projectId, column.slug],
      )) as { value: number }[])
    : [];

  return {
    ticket: `${task.projectSlug}-${task.number}`,
    title: task.title,
    labels: labels.map((label) => ({
      name: label.name,
      color: resolveLabelColor(label.color),
    })),
    priority: resolvePriority(task.priority),
    dueDate: task.dueDate ?? undefined,
    dueStatus: task.dueDate
      ? resolveDueStatus(task.dueDate, column?.isFinal ?? false)
      : undefined,
    assigneeInitials: getInitials(task.assigneeName),
    column: column
      ? {
          name: column.name,
          icon: resolveColumnIcon(column),
          count: columnCount?.value,
        }
      : undefined,
  };
}
