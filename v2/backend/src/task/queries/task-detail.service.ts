import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { boundedTaskRead } from "./bounded-task-read";
import { boardDescriptionSql, descriptionDeferredSql } from "./description-sql";
import { getSubtaskCounts } from "./subtask-counts";

export type TaskDetail = {
  id: string;
  title: string;
  number: number | null;
  description: string | null;
  descriptionDeferred?: boolean;
  status: string;
  columnId: string | null;
  phaseId: string | null;
  sprintId: string | null;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedMinutes: number | null;
  position: number | null;
  createdAt: Date;
  userId: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  projectId: string;
  workspaceId: string;
};

/** One task with its assignee; the board view adds subtask progress. */
@Injectable()
export class TaskDetailService {
  constructor(private readonly dataSource: DataSource) {}

  async getTask(taskId: string): Promise<TaskDetail> {
    return this.findTask(taskId, false);
  }

  async getBoardTask(taskId: string, userId?: string) {
    const { workspaceId, ...result } = await this.findTask(taskId, true);
    if (!workspaceId) return result;
    const parents = (await this.dataSource.query(
      `SELECT DISTINCT parent.id FROM task_relation r
       INNER JOIN task parent ON r.source_task_id = parent.id
       WHERE r.target_task_id = $1 AND r.relation_type = 'subtask'
         AND parent.project_id = $2`,
      [taskId, result.projectId],
    )) as { id: string }[];
    const counts = await boundedTaskRead(this.dataSource, (tx) =>
      getSubtaskCounts(
        tx,
        [taskId, ...parents.map((task) => task.id)],
        workspaceId,
        false,
        userId,
      ),
    );
    return {
      ...result,
      subtaskCounts: counts.get(taskId) ?? { completed: 0, total: 0 },
      parentSubtaskCounts: parents.map(({ id }) => ({
        taskId: id,
        ...(counts.get(id) ?? { completed: 0, total: 0 }),
      })),
    };
  }

  private async findTask(taskId: string, board: boolean): Promise<TaskDetail> {
    const description = board
      ? `${boardDescriptionSql("t.description")} AS description,
         ${descriptionDeferredSql("t.description")} AS "descriptionDeferred"`
      : "t.description";
    const [task] = (await this.dataSource.query(
      `SELECT t.id, t.title, t.number, ${description}, t.status,
         t.column_id AS "columnId", t.phase_id AS "phaseId",
         t.sprint_id AS "sprintId", t.priority, t.start_date AS "startDate",
         t.due_date AS "dueDate", t.estimated_minutes AS "estimatedMinutes",
         t.position, t.created_at AS "createdAt", t.assignee_id AS "userId",
         u.name AS "assigneeName", u.id AS "assigneeId",
         t.project_id AS "projectId",
         (SELECT p.workspace_id FROM project p WHERE p.id = t.project_id) AS "workspaceId"
       FROM task t LEFT JOIN "user" u ON t.assignee_id = u.id
       WHERE t.id = $1 LIMIT 1`,
      [taskId],
    )) as TaskDetail[];

    if (!task) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }
    return task;
  }
}
