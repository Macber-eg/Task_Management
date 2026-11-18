import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

export type ChatTaskRow = {
  id: string;
  title: string;
  number: number | null;
  status: string;
  priority: string | null;
  /** The task's column in its own project, if any. */
  columnName: string | null;
  projectId: string;
  projectName: string;
  workspaceId: string;
};

export type ChatProjectRow = { id: string; name: string; workspaceId: string };

/** The reads every outbound channel makes to describe a task event. */
@Injectable()
export class ChatTaskReader {
  constructor(private readonly dataSource: DataSource) {}

  /** The task if it still belongs to `projectId`. */
  async readTask(
    taskId: string,
    projectId: string,
  ): Promise<ChatTaskRow | undefined> {
    const [row] = (await this.dataSource.query(
      `SELECT t.id, t.title, t.number, t.status, t.priority,
              c.name AS "columnName", p.id AS "projectId",
              p.name AS "projectName", w.id AS "workspaceId"
         FROM task t
         JOIN project p ON t.project_id = p.id
         JOIN workspace w ON p.workspace_id = w.id
         LEFT JOIN "column" c ON t.column_id = c.id AND c.project_id = p.id
        WHERE t.id = $1 AND p.id = $2
        LIMIT 1`,
      [taskId, projectId],
    )) as ChatTaskRow[];
    return row;
  }

  async readUser(
    userId: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const [user] = (await this.dataSource.query(
      `SELECT id, name FROM "user" WHERE id = $1 LIMIT 1`,
      [userId],
    )) as { id: string; name: string }[];
    return user;
  }

  async readProject(projectId: string): Promise<ChatProjectRow | undefined> {
    const [project] = (await this.dataSource.query(
      `SELECT id, name, workspace_id AS "workspaceId" FROM project WHERE id = $1 LIMIT 1`,
      [projectId],
    )) as ChatProjectRow[];
    return project;
  }
}
