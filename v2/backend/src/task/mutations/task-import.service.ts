import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { EventBus } from "../../events/event-bus";
import {
  filterAssignableUsers,
  filterUsersWithProjectAccess,
  NO_PROJECT_ACCESS,
  NOT_ASSIGNABLE,
} from "../shared/assignable-users";
import { claimTaskNumber } from "../shared/claim-task-numbers";
import { nextTaskPosition } from "../shared/next-task-position";
import { coercePriority } from "../shared/task-priority";
import {
  coerceStatus,
  findStatusColumnId,
  getValidTaskStatuses,
} from "../shared/task-status";
import { insertTask } from "../shared/task-writes";

export type ImportTask = {
  title: string;
  description?: string;
  status: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  userId?: string | null;
};

/**
 * Creates tasks from an export, one transaction each, reporting every task's
 * outcome. Unknown statuses and priorities are coerced with a warning.
 */
@Injectable()
export class TaskImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async importTasks(
    projectId: string,
    tasksToImport: ImportTask[],
    currentUserId?: string,
  ) {
    const manager = this.dataSource.manager;
    const [project] = (await manager.query(
      `SELECT id, name, slug, workspace_id AS "workspaceId" FROM project
       WHERE id = $1 LIMIT 1`,
      [projectId],
    )) as { id: string; name: string; slug: string; workspaceId: string }[];

    if (!project) {
      throw new HTTPException(404, {
        message: "Project not found",
      });
    }

    const assigneeIds = [
      ...new Set(
        tasksToImport
          .map((task) => task.userId?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const memberIds = await filterAssignableUsers(
      manager,
      assigneeIds,
      project.workspaceId,
    );
    const assignableIds = await filterUsersWithProjectAccess(
      manager,
      memberIds,
      projectId,
    );

    const validStatuses = await getValidTaskStatuses(manager, projectId);

    const results = [];

    for (const taskData of tasksToImport) {
      const assigneeId = taskData.userId?.trim() || null;

      if (assigneeId && !assignableIds.has(assigneeId)) {
        results.push({
          success: false,
          error: memberIds.has(assigneeId) ? NO_PROJECT_ACCESS : NOT_ASSIGNABLE,
          task: taskData,
        });
        continue;
      }

      try {
        const { status, warning: statusWarning } = coerceStatus(
          taskData.status,
          validStatuses,
        );
        const { priority, warning: priorityWarning } = coercePriority(
          taskData.priority || "low",
        );
        const warnings = [statusWarning, priorityWarning].filter(Boolean);

        const columnId = await findStatusColumnId(manager, projectId, status);

        const createdTask = await this.dataSource.transaction(async (tx) => {
          const taskNumber = await claimTaskNumber(tx, projectId);
          const position = await nextTaskPosition(
            tx,
            projectId,
            status,
            columnId,
          );

          return insertTask(tx, {
            projectId,
            userId: assigneeId,
            title: taskData.title,
            status,
            columnId,
            startDate: taskData.startDate ? new Date(taskData.startDate) : null,
            dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
            description: taskData.description || "",
            priority,
            number: taskNumber,
            position,
          });
        });

        if (createdTask) {
          await this.events.publish("task.created", {
            ...createdTask,
            taskId: createdTask.id,
            userId: createdTask.userId ?? "",
            currentUserId: currentUserId ?? "",
            type: "create",
            content: "imported the task",
          });

          results.push({
            success: true,
            task: createdTask,
            ...(warnings.length > 0 && { warnings }),
          });
        } else {
          results.push({
            success: false,
            error: "Failed to create task",
            task: taskData,
          });
        }
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        results.push({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          task: taskData,
        });
      }
    }

    return {
      importedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
      },
      results: {
        total: tasksToImport.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        tasks: results,
      },
    };
  }
}
