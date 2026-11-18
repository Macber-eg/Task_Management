import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { ProjectAccessService } from "../access/project-access.service";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { TaskRelationEntity } from "../database/entities/task-relation.entity";
import { EventBus } from "../events/event-bus";

type WorkspaceTask = { id: string; projectId: string; workspaceId: string };

function findWorkspaceTask(
  tx: EntityManager,
  taskId: string,
  workspaceId: string,
): Promise<WorkspaceTask | undefined> {
  return tx
    .query(
      `SELECT t.id, t.project_id AS "projectId", p.workspace_id AS "workspaceId"
       FROM task AS t
       INNER JOIN project AS p ON t.project_id = p.id
       WHERE t.id = $1 AND p.workspace_id = $2
       LIMIT 1`,
      [taskId, workspaceId],
    )
    .then((rows: WorkspaceTask[]) => rows[0]);
}

export type NewTaskRelation = {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  userId: string;
  workspaceId: string;
};

@Injectable()
export class TaskRelationCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projectAccess: ProjectAccessService,
    private readonly events: EventBus,
  ) {}

  async createTaskRelation({
    sourceTaskId,
    targetTaskId,
    relationType,
    userId,
    workspaceId,
  }: NewTaskRelation): Promise<TaskRelationEntity> {
    if (sourceTaskId === targetTaskId) {
      throw new HTTPException(400, {
        message: "Cannot create a relation between a task and itself",
      });
    }

    const { relation, sourceTask } = await this.dataSource.transaction(
      async (tx) => {
        // Serialize relation creation with project moves before validating
        // either workspace. A move must see this relation or this request
        // must see the move.
        await tx.query(
          `SELECT p.id FROM project AS p
           WHERE p.id IN (
             SELECT t.project_id FROM task AS t WHERE t.id = ANY($1::text[])
           )
           ORDER BY p.id
           FOR SHARE`,
          [[sourceTaskId, targetTaskId]],
        );

        const sourceTask = await findWorkspaceTask(
          tx,
          sourceTaskId,
          workspaceId,
        );
        if (!sourceTask) {
          throw new HTTPException(404, { message: "Source task not found" });
        }

        const targetTask = await findWorkspaceTask(
          tx,
          targetTaskId,
          workspaceId,
        );
        if (!targetTask) {
          throw new HTTPException(404, { message: "Target task not found" });
        }

        await this.projectAccess.assertProjectAccess(
          userId,
          targetTask.projectId,
        );

        const existing = (await tx.query(
          `SELECT id FROM task_relation
           WHERE relation_type = $1
             AND ((source_task_id = $2 AND target_task_id = $3)
               OR (source_task_id = $3 AND target_task_id = $2))
           LIMIT 1`,
          [relationType, sourceTaskId, targetTaskId],
        )) as { id: string }[];

        if (existing.length > 0) {
          throw new HTTPException(409, {
            message: "This relation already exists",
          });
        }

        const relation = await insertReturning(tx, TaskRelationEntity, {
          sourceTaskId,
          targetTaskId,
          relationType,
        });

        if (!relation) {
          throw new HTTPException(500, {
            message: "Failed to create task relation",
          });
        }

        return { relation, sourceTask };
      },
    );

    await this.events.publish("task-relation.created", {
      ...relation,
      taskId: sourceTaskId,
      projectId: sourceTask.projectId,
      userId,
    });

    return relation;
  }
}
