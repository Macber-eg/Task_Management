import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { EventBus } from "../../events/event-bus";
import { TaskMutationEffects } from "../effects/task-mutation-effects.service";
import {
  boardDescriptionSql,
  descriptionDeferredSql,
} from "../queries/description-sql";
import {
  assertAssignableUser,
  getProjectWorkspaceId,
} from "../shared/assignable-users";
import { assertTaskPosition } from "../shared/task-position";
import type { TaskRow } from "../shared/task-row";
import {
  assertValidTaskStatus,
  findStatusColumnId,
} from "../shared/task-status";
import { updateTask } from "../shared/task-writes";

export type UpdateTaskInput = {
  id: string;
  title: string;
  status: string;
  startDate: Date | undefined;
  dueDate: Date | undefined;
  projectId: string;
  description?: string;
  priority: string;
  position: number;
  userId?: string;
  currentUserId?: string;
};

type ExistingTask = Pick<
  TaskRow,
  | "id"
  | "title"
  | "priority"
  | "userId"
  | "dueDate"
  | "description"
  | "status"
  | "columnId"
  | "position"
  | "projectId"
>;

/**
 * Selects what a full update compares against. Without a new description
 * the stored one is not read (it may be large), and reads as null.
 */
async function findExisting(
  manager: EntityManager,
  id: string,
  withDescription: boolean,
  lockInProject?: string,
): Promise<ExistingTask | undefined> {
  const [task] = (await manager.query(
    `SELECT id, title, priority, assignee_id AS "userId", due_date AS "dueDate",
       ${withDescription ? "description" : "null"} AS description, status,
       column_id AS "columnId", position, project_id AS "projectId"
     FROM task
     WHERE id = $1${lockInProject ? " AND project_id = $2 FOR UPDATE" : " LIMIT 1"}`,
    lockInProject ? [id, lockInProject] : [id],
  )) as ExistingTask[];
  return task;
}

/** Replaces every field of a task. */
@Injectable()
export class TaskUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly effects: TaskMutationEffects,
  ) {}

  async updateTask(input: UpdateTaskInput) {
    const { id, projectId, description, currentUserId } = input;
    assertTaskPosition(input.position);
    const manager = this.dataSource.manager;
    const withDescription = description !== undefined;

    let existingTask = await findExisting(manager, id, withDescription);

    if (!existingTask) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    if (projectId !== existingTask.projectId) {
      throw new HTTPException(400, {
        message: "Use the task move endpoint to move tasks between projects",
      });
    }

    await assertValidTaskStatus(manager, input.status, projectId);

    const normalizedUserId = input.userId?.trim() || undefined;

    if (normalizedUserId && normalizedUserId !== existingTask.userId) {
      await assertAssignableUser(
        manager,
        normalizedUserId,
        await getProjectWorkspaceId(manager, projectId),
        projectId,
      );
    }

    const columnId = await findStatusColumnId(manager, projectId, input.status);

    const initialPosition = existingTask.position;
    const initialStatus = existingTask.status;
    const updatedTask = await this.dataSource.transaction(async (tx) => {
      const [project] = (await tx.query(
        `SELECT id FROM project WHERE id = $1 FOR UPDATE`,
        [projectId],
      )) as { id: string }[];
      if (!project)
        throw new HTTPException(404, { message: "Project not found" });
      const locked = await findExisting(tx, id, withDescription, projectId);
      if (!locked)
        throw new HTTPException(409, {
          message: "Task changed projects; retry the update",
        });
      if (
        locked.position !== initialPosition ||
        locked.status !== initialStatus
      )
        throw new HTTPException(409, {
          message: "Task order changed; refresh before updating",
        });
      existingTask = locked;

      const written = await updateTask(
        tx,
        id,
        {
          title: input.title,
          status: input.status,
          columnId,
          startDate: input.startDate || null,
          dueDate: input.dueDate || null,
          projectId,
          ...(withDescription ? { description } : {}),
          priority: input.priority,
          position: input.position,
          userId: normalizedUserId ?? null,
        },
        { projectId },
      );
      if (!written) return undefined;
      const task = await this.readBoundedDescription(tx, written);
      await this.effects.recordTaskMutation(
        tx,
        locked,
        { title: input.title, dueDate: input.dueDate ?? null },
        currentUserId,
      );
      return task;
    });

    if (!updatedTask) {
      throw new HTTPException(500, {
        message: "Failed to update task",
      });
    }

    await this.effects.publishTaskMutation(
      {
        ...existingTask,
        description: withDescription ? existingTask.description : undefined,
      },
      {
        ...updatedTask,
        description: description ?? updatedTask.description,
      },
      currentUserId,
    );

    await this.events.publish("task.updated", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      title: updatedTask.title,
      status: updatedTask.status,
      userId: currentUserId,
    });

    return updatedTask;
  }

  /** The response omits a description too large for list views. */
  private async readBoundedDescription(tx: EntityManager, task: TaskRow) {
    const [bounded] = (await tx.query(
      `SELECT ${boardDescriptionSql("t.description")} AS description,
         ${descriptionDeferredSql("t.description")} AS "descriptionDeferred"
       FROM task t WHERE t.id = $1`,
      [task.id],
    )) as { description: string | null; descriptionDeferred: boolean }[];
    return {
      ...task,
      description: bounded?.description ?? null,
      descriptionDeferred: bounded?.descriptionDeferred ?? false,
    };
  }
}
