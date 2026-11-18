import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";
import { HTTPException } from "../common/errors/http-exception";
import { EventBus } from "../events/event-bus";

type DeletedRelation = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  createdAt: Date;
};

@Injectable()
export class TaskRelationDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async deleteTaskRelation(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<DeletedRelation> {
    const manager = this.dataSource.manager;
    const workspaceTasks = `SELECT t.id FROM task AS t
      INNER JOIN project AS p ON t.project_id = p.id
      WHERE p.workspace_id = $2
        AND ${projectAccessCondition("$3", "t.project_id")}`;

    // Check both endpoints in the delete statement itself. Legacy cross-tenant
    // rows must not bypass the same boundary enforced on creation and reads.
    // A DELETE answers [rows, affected count].
    const [[relation]] = (await manager.query(
      `DELETE FROM task_relation
       WHERE id = $1
         AND source_task_id IN (${workspaceTasks})
         AND target_task_id IN (${workspaceTasks})
       RETURNING id, source_task_id AS "sourceTaskId",
                 target_task_id AS "targetTaskId",
                 relation_type AS "relationType", created_at AS "createdAt"`,
      [id, workspaceId, userId],
    )) as [DeletedRelation[], number];

    if (!relation) {
      throw new HTTPException(404, {
        message: "Task relation not found",
      });
    }

    const [task] = (await manager.query(
      `SELECT t.project_id AS "projectId"
       FROM task AS t
       INNER JOIN project AS p ON t.project_id = p.id
       WHERE t.id = $1 AND p.workspace_id = $2
       LIMIT 1`,
      [relation.sourceTaskId, workspaceId],
    )) as { projectId: string }[];

    if (task) {
      await this.events.publish("task-relation.deleted", {
        ...relation,
        taskId: relation.sourceTaskId,
        projectId: task.projectId,
        userId,
      });
    }

    return relation;
  }
}
