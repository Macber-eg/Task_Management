import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { EventBus } from "../../events/event-bus";
import { assertRequiredCustomFields } from "../shared/assert-required-custom-fields";
import {
  assertAssignableUser,
  getProjectWorkspaceId,
} from "../shared/assignable-users";
import { claimTaskNumber } from "../shared/claim-task-numbers";
import { extractAssetIds } from "../../storage/cleanup/asset-references";
import {
  type CustomFieldInput,
  findCustomFieldDefinitions,
} from "../shared/custom-field-definitions";
import { isCustomFieldValueEmpty } from "../shared/custom-field-values";
import { insertCustomFieldValues } from "../shared/insert-custom-field-values";
import { nextTaskPosition } from "../shared/next-task-position";
import {
  assertValidTaskStatus,
  findStatusColumnId,
} from "../shared/task-status";
import { insertTask } from "../shared/task-writes";

export type CreateTaskInput = {
  projectId: string;
  currentUserId: string;
  userId?: string;
  title: string;
  status: string;
  startDate?: Date;
  dueDate?: Date;
  description?: string;
  priority?: string;
  customFields?: CustomFieldInput[];
  draftAssetIds?: string[];
  estimatedMinutes?: number;
};

function deduplicateCustomFields(
  customFields?: CustomFieldInput[],
): CustomFieldInput[] | undefined {
  if (!customFields) return undefined;
  const fieldsById = new Map<string, CustomFieldInput>();
  for (const customField of customFields) {
    fieldsById.set(customField.fieldId, customField);
  }
  return Array.from(fieldsById.values());
}

@Injectable()
export class TaskCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async createTask(input: CreateTaskInput) {
    const { projectId, currentUserId } = input;
    const manager = this.dataSource.manager;
    const resolvedStatus = input.status || "to-do";
    const resolvedPriority = input.priority || "no-priority";
    const normalizedUserId = input.userId?.trim() || undefined;

    await assertValidTaskStatus(manager, resolvedStatus, projectId);

    const customFields = await this.withRequiredDefaults(
      manager,
      projectId,
      deduplicateCustomFields(input.customFields) ?? [],
    );
    await assertRequiredCustomFields(manager, projectId, customFields);

    let assignee: { name: string } | undefined;
    if (normalizedUserId) {
      await assertAssignableUser(
        manager,
        normalizedUserId,
        await getProjectWorkspaceId(manager, projectId),
        projectId,
      );
      [assignee] = (await manager.query(
        `SELECT name FROM "user" WHERE id = $1`,
        [normalizedUserId],
      )) as { name: string }[];
    }

    const columnId = await findStatusColumnId(
      manager,
      projectId,
      resolvedStatus,
    );

    const createdTask = await this.dataSource.transaction(async (tx) => {
      const taskNumber = await claimTaskNumber(tx, projectId);
      const nextPosition = await nextTaskPosition(
        tx,
        projectId,
        resolvedStatus,
        columnId,
      );

      const task = await insertTask(tx, {
        projectId,
        userId: normalizedUserId ?? null,
        title: input.title || "",
        status: resolvedStatus,
        columnId,
        startDate: input.startDate || null,
        dueDate: input.dueDate || null,
        description: input.description || "",
        priority: resolvedPriority,
        estimatedMinutes:
          input.estimatedMinutes != null && input.estimatedMinutes >= 0
            ? input.estimatedMinutes
            : null,
        number: taskNumber,
        position: nextPosition,
      });

      if (task && input.draftAssetIds?.length) {
        await this.claimDraftAssets(tx, task.id, input);
      }

      if (task && customFields.length) {
        await insertCustomFieldValues(
          tx,
          customFields.map(({ fieldId, value }) => ({
            taskId: task.id,
            fieldId,
            value: value.trim(),
          })),
        );
      }

      return task;
    });

    if (!createdTask) {
      throw new HTTPException(500, {
        message: "Failed to create task",
      });
    }

    await this.events.publish("task.created", {
      ...createdTask,
      taskId: createdTask.id,
      userId: createdTask.userId ?? "",
      currentUserId,
      type: "created",
      content: null,
    });

    return {
      ...createdTask,
      assigneeName: assignee?.name,
    };
  }

  /** Required fields the caller left out are filled from their defaults. */
  private async withRequiredDefaults(
    manager: EntityManager,
    projectId: string,
    customFields: CustomFieldInput[],
  ) {
    const providedFieldIds = new Set(customFields.map((f) => f.fieldId));
    for (const field of await findCustomFieldDefinitions(manager, projectId)) {
      if (
        !providedFieldIds.has(field.id) &&
        field.required &&
        field.defaultValue != null &&
        !isCustomFieldValueEmpty(field.defaultValue, field.type)
      ) {
        customFields.push({ fieldId: field.id, value: field.defaultValue });
      }
    }
    return customFields;
  }

  /** Staged uploads the description references become the task's assets. */
  private async claimDraftAssets(
    tx: EntityManager,
    taskId: string,
    input: CreateTaskInput,
  ) {
    const referenced = extractAssetIds(input.description);
    const ids = [...new Set(input.draftAssetIds)].filter((id) =>
      referenced.has(id),
    );
    if (!ids.length) return;
    // claimTaskNumber already holds the project row lock in this transaction.
    const [project] = (await tx.query(
      `SELECT workspace_id AS "workspaceId" FROM project WHERE id = $1 LIMIT 1`,
      [input.projectId],
    )) as { workspaceId: string }[];
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    const [claimed] = (await tx.query(
      `UPDATE asset SET task_id = $1, surface = 'description', workspace_id = $2
       WHERE id = ANY($3::text[]) AND project_id = $4 AND created_by = $5
         AND surface = 'draft' AND task_id IS NULL
       RETURNING id`,
      [taskId, project.workspaceId, ids, input.projectId, input.currentUserId],
    )) as [{ id: string }[], number];
    if (claimed.length !== ids.length)
      throw new HTTPException(400, {
        message:
          "Some staged uploads are unavailable or belong to another owner/project",
      });
  }
}
