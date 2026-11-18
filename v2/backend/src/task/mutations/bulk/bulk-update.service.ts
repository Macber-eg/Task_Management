import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { BulkDeleteOperation } from "./bulk-delete.operation";
import { BulkFieldOperations } from "./bulk-field.operations";
import { BulkLabelOperations } from "./bulk-label.operations";
import { BulkStatusOperation } from "./bulk-status.operation";
import type { BulkContext, BulkOperation, BulkTask } from "./bulk-task";

/** Applies one operation to many tasks of a single workspace. */
@Injectable()
export class BulkUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly status: BulkStatusOperation,
    private readonly fields: BulkFieldOperations,
    private readonly deletion: BulkDeleteOperation,
    private readonly labels: BulkLabelOperations,
  ) {}

  async bulkUpdateTasks({
    taskIds,
    operation,
    value,
    userId,
  }: {
    taskIds: string[];
    operation: BulkOperation;
    value?: string | null;
    userId: string;
  }) {
    const context = await this.loadContext(taskIds, value, userId);

    let updatedCount: number;
    switch (operation) {
      case "updateStatus":
        updatedCount = await this.status.run(context);
        break;
      case "updatePriority":
        updatedCount = await this.fields.updatePriority(context);
        break;
      case "updateAssignee":
        updatedCount = await this.fields.updateAssignee(context);
        break;
      case "delete":
        updatedCount = await this.deletion.run(context);
        break;
      case "addLabel":
        updatedCount = await this.labels.addLabel(context);
        break;
      case "removeLabel":
        updatedCount = await this.labels.removeLabel(context);
        break;
      case "updateDueDate":
        updatedCount = await this.fields.updateDueDate(context);
        break;
      default:
        throw new HTTPException(400, {
          message: `Unknown operation "${String(operation)}"`,
        });
    }

    return { success: true, updatedCount };
  }

  private async loadContext(
    taskIds: string[],
    value: string | null | undefined,
    userId: string,
  ): Promise<BulkContext> {
    const manager = this.dataSource.manager;
    const tasks = (await manager.query(
      `SELECT t.id, t.title, t.status, t.priority, t.project_id AS "projectId",
         t.assignee_id AS "userId", t.due_date AS "dueDate",
         p.workspace_id AS "workspaceId"
       FROM task t INNER JOIN project p ON t.project_id = p.id
       WHERE t.id = ANY($1::text[])`,
      [taskIds],
    )) as BulkTask[];

    if (tasks.length === 0) {
      throw new HTTPException(404, {
        message: "No tasks found",
      });
    }

    const workspaceIds = [...new Set(tasks.map((t) => t.workspaceId))];

    if (workspaceIds.length > 1) {
      throw new HTTPException(400, {
        message: "All tasks must belong to the same workspace",
      });
    }

    const workspaceId = workspaceIds[0];

    if (!workspaceId) {
      throw new HTTPException(400, {
        message: "Could not determine workspace",
      });
    }

    const [membership] = (await manager.query(
      `SELECT id FROM workspace_member
       WHERE user_id = $1 AND workspace_id = $2 LIMIT 1`,
      [userId, workspaceId],
    )) as { id: string }[];

    if (!membership) {
      throw new HTTPException(403, {
        message: "You don't have access to this workspace",
      });
    }

    return {
      tasks,
      foundIds: tasks.map((t) => t.id),
      workspaceId,
      value,
      userId,
    };
  }
}
