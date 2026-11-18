import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { ProjectAccessService } from "../../access/project-access.service";
import { createActivities } from "../../activity/create-activities";
import { HTTPException } from "../../common/errors/http-exception";
import { EventBus } from "../../events/event-bus";
import { filterUsersWithProjectAccess } from "../shared/assignable-users";
import { claimTaskNumber } from "../shared/claim-task-numbers";
import { nextTaskPosition } from "../shared/next-task-position";
import { findTaskRow, type TaskRow } from "../shared/task-row";
import { updateTask } from "../shared/task-writes";

type MoveProject = { id: string; name: string; workspaceId: string };
type DestinationColumn = { id: string; slug: string; position: number };

async function findProject(
  manager: EntityManager,
  id: string,
  workspaceId?: string,
): Promise<MoveProject> {
  const [project] = (await manager.query(
    `SELECT id, name, workspace_id AS "workspaceId" FROM project
     WHERE id = $1${workspaceId ? " AND workspace_id = $2" : ""} LIMIT 1`,
    workspaceId ? [id, workspaceId] : [id],
  )) as MoveProject[];
  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }
  return project;
}

/** The requested column, else the one matching the current status, else the first. */
async function resolveDestinationColumn(
  manager: EntityManager,
  destinationProjectId: string,
  currentStatus: string,
  requestedStatus?: string,
): Promise<DestinationColumn> {
  const destinationColumns = (await manager.query(
    `SELECT id, slug, position FROM "column" WHERE project_id = $1
     ORDER BY position ASC`,
    [destinationProjectId],
  )) as DestinationColumn[];

  const [firstColumn] = destinationColumns;

  if (!firstColumn) {
    throw new HTTPException(400, {
      message: "Destination project does not have a workflow",
    });
  }

  const requestedColumn = requestedStatus
    ? destinationColumns.find((column) => column.slug === requestedStatus)
    : null;

  if (requestedStatus && !requestedColumn) {
    throw new HTTPException(400, {
      message: "Selected status is not valid for the destination project",
    });
  }

  const matchingCurrentColumn = destinationColumns.find(
    (column) => column.slug === currentStatus,
  );

  return requestedColumn ?? matchingCurrentColumn ?? firstColumn;
}

/** Moves a task to another project of the same workspace. */
@Injectable()
export class TaskMoveService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async moveTask({
    taskId,
    destinationProjectId,
    destinationStatus,
    currentUserId,
  }: {
    taskId: string;
    destinationProjectId: string;
    destinationStatus?: string;
    currentUserId: string;
  }) {
    const manager = this.dataSource.manager;
    const existingTask = await findTaskRow(manager, taskId);

    if (!existingTask) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    if (existingTask.projectId === destinationProjectId) {
      throw new HTTPException(400, {
        message: "Task is already in that project",
      });
    }

    const sourceProject = await findProject(manager, existingTask.projectId);
    const destinationProject = await findProject(
      manager,
      destinationProjectId,
      sourceProject.workspaceId,
    );

    await this.projectAccess.assertProjectAccess(
      currentUserId,
      destinationProjectId,
    );

    const resolvedColumn = await resolveDestinationColumn(
      manager,
      destinationProjectId,
      existingTask.status,
      destinationStatus,
    );

    const movedTask = await this.dataSource.transaction((tx) =>
      this.moveInTransaction(
        tx,
        existingTask,
        sourceProject,
        destinationProjectId,
        resolvedColumn,
        currentUserId,
      ),
    );

    await this.events.publish("task.moved", {
      taskId,
      type: "moved",
      userId: currentUserId,
      fromProjectId: sourceProject.id,
      fromProjectName: sourceProject.name,
      toProjectId: destinationProject.id,
      toProjectName: destinationProject.name,
      oldStatus: existingTask.status,
      newStatus: resolvedColumn.slug,
    });

    return {
      task: movedTask,
      sourceProjectId: sourceProject.id,
      destinationProjectId: destinationProject.id,
    };
  }

  private async moveInTransaction(
    tx: EntityManager,
    task: TaskRow,
    sourceProject: MoveProject,
    destinationProjectId: string,
    column: DestinationColumn,
    currentUserId: string,
  ): Promise<TaskRow> {
    for (const projectId of [sourceProject.id, destinationProjectId].sort()) {
      const [project] = (await tx.query(
        `SELECT id FROM project WHERE id = $1 AND workspace_id = $2
         FOR KEY SHARE`,
        [projectId, sourceProject.workspaceId],
      )) as { id: string }[];
      if (!project)
        throw new HTTPException(409, {
          message: "Project was moved to another workspace, please try again",
        });
    }
    const nextTaskNumber = await claimTaskNumber(tx, destinationProjectId);
    const nextPosition = await nextTaskPosition(
      tx,
      destinationProjectId,
      column.slug,
      column.id,
    );

    const updatedTask = await updateTask(
      tx,
      task.id,
      {
        projectId: destinationProjectId,
        status: column.slug,
        columnId: column.id,
        number: nextTaskNumber,
        position: nextPosition,
      },
      { projectId: sourceProject.id },
    );

    if (!updatedTask) {
      throw new HTTPException(409, {
        message: "Task was moved concurrently, please try again",
      });
    }

    let movedTask = updatedTask;
    const assigneeId = updatedTask.userId;
    if (
      assigneeId &&
      !(
        await filterUsersWithProjectAccess(
          tx,
          [assigneeId],
          destinationProjectId,
        )
      ).has(assigneeId)
    ) {
      const unassignedTask = await updateTask(tx, task.id, { userId: null });
      movedTask = unassignedTask ?? { ...updatedTask, userId: null };
      await createActivities(tx, [
        {
          taskId: task.id,
          type: "unassigned",
          userId: currentUserId,
          content: null,
          eventData: {},
        },
      ]);
    }

    // Links created by the source project's integrations do not follow.
    await tx.query(
      `DELETE FROM external_link
       WHERE task_id = $1 AND integration_id IS NOT NULL
         AND integration_id NOT IN (
           SELECT id FROM integration WHERE project_id = $2
         )`,
      [task.id, destinationProjectId],
    );

    await tx.query(`UPDATE asset SET project_id = $1 WHERE task_id = $2`, [
      destinationProjectId,
      task.id,
    ]);

    return movedTask;
  }
}
