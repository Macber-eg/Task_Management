import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";

type ExportRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  userId: string | null;
};

/** A project's tasks with their labels, as a portable JSON document. */
@Injectable()
export class TaskExportService {
  constructor(private readonly dataSource: DataSource) {}

  async exportTasks(projectId: string) {
    const [project] = (await this.dataSource.query(
      `SELECT name, slug, description FROM project WHERE id = $1 LIMIT 1`,
      [projectId],
    )) as { name: string; slug: string; description: string | null }[];

    if (!project) {
      throw new HTTPException(404, {
        message: "Project not found",
      });
    }

    const tasks = (await this.dataSource.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority,
         t.start_date AS "startDate", t.due_date AS "dueDate",
         t.assignee_id AS "userId"
       FROM task t LEFT JOIN "user" u ON t.assignee_id = u.id
       WHERE t.project_id = $1 ORDER BY t.position`,
      [projectId],
    )) as ExportRow[];

    const labels = tasks.length
      ? ((await this.dataSource.query(
          `SELECT name, color, task_id AS "taskId" FROM label
           WHERE task_id = ANY($1::text[])`,
          [tasks.map((task) => task.id)],
        )) as { name: string; color: string; taskId: string | null }[])
      : [];

    const taskLabels = new Map<string, { name: string; color: string }[]>();
    for (const { taskId, name, color } of labels) {
      if (!taskId) continue;
      const list = taskLabels.get(taskId) ?? [];
      list.push({ name, color });
      taskLabels.set(taskId, list);
    }

    return {
      project: {
        name: project.name,
        slug: project.slug,
        description: project.description,
        exportedAt: new Date().toISOString(),
      },
      tasks: tasks.map((task) => ({
        title: task.title,
        description: task.description || "",
        status: task.status,
        priority: task.priority || "low",
        dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
        startDate: task.startDate
          ? new Date(task.startDate).toISOString()
          : null,
        userId: task.userId || null,
        labels: taskLabels.get(task.id) || [],
      })),
    };
  }
}
