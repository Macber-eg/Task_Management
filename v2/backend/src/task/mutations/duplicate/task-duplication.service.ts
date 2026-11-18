import { Injectable } from "@nestjs/common";
import { createId } from "@paralleldrive/cuid2";
import { DataSource, type EntityManager } from "typeorm";
import { projectAccessCondition } from "../../../access/project-access-condition";
import { HTTPException } from "../../../common/errors/http-exception";
import { insertReturning } from "../../../database/dml";
import { AssetEntity } from "../../../database/entities/asset.entity";
import { LabelEntity } from "../../../database/entities/label.entity";
import { TaskRelationEntity } from "../../../database/entities/task-relation.entity";
import { EventBus } from "../../../events/event-bus";
import { TaskAssetStorage } from "../../seams/task-asset-storage";
import { assertRequiredCustomFields } from "../../shared/assert-required-custom-fields";
import {
  filterAssignableUsers,
  filterUsersWithProjectAccess,
  NOT_ASSIGNABLE,
} from "../../shared/assignable-users";
import { claimTaskNumber } from "../../shared/claim-task-numbers";
import {
  type CustomFieldInput,
  findCustomFieldDefinitions,
} from "../../shared/custom-field-definitions";
import { insertCustomFieldValues } from "../../shared/insert-custom-field-values";
import { nextTaskPosition } from "../../shared/next-task-position";
import { findTaskRow, type TaskRow } from "../../shared/task-row";
import {
  assertValidTaskStatus,
  findStatusColumnId,
} from "../../shared/task-status";
import { insertTask } from "../../shared/task-writes";
import {
  type AssetCopy,
  discardCopiedObjects,
  duplicateDescriptionAssets,
} from "./duplicate-description-assets";

type ParentRelation = {
  parentTaskId: string;
  parentProjectId: string;
  relationType: string;
};

type SourceLabel = { name: string; color: string; workspaceId: string };

export type DuplicateTaskInput = {
  taskId: string;
  currentUserId: string;
  canUpdateTasks: boolean;
  title?: string;
};

/** Copies a task into its own project and column. */
@Injectable()
export class TaskDuplicationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly storage: TaskAssetStorage,
  ) {}

  async duplicateTask({
    taskId,
    currentUserId,
    canUpdateTasks,
    title,
  }: DuplicateTaskInput) {
    const manager = this.dataSource.manager;
    const sourceTask = await findTaskRow(manager, taskId);

    if (!sourceTask) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    const [project] = (await manager.query(
      `SELECT workspace_id AS "workspaceId" FROM project WHERE id = $1 LIMIT 1`,
      [sourceTask.projectId],
    )) as { workspaceId: string }[];

    if (!project) {
      throw new HTTPException(404, {
        message: "Project not found",
      });
    }

    await assertValidTaskStatus(
      manager,
      sourceTask.status,
      sourceTask.projectId,
    );
    const assigneeId = await this.copiedAssignee(
      manager,
      sourceTask,
      project.workspaceId,
    );
    const columnId = await findStatusColumnId(
      manager,
      sourceTask.projectId,
      sourceTask.status,
    );
    const customFields = await this.copiedCustomFields(manager, sourceTask);
    await assertRequiredCustomFields(
      manager,
      sourceTask.projectId,
      customFields,
    );

    const sourceLabels = (await manager.query(
      `SELECT name, color, workspace_id AS "workspaceId" FROM label
       WHERE task_id = $1 AND workspace_id = $2`,
      [sourceTask.id, project.workspaceId],
    )) as SourceLabel[];

    // A duplicated subtask stays a subtask of the same parents. The source's
    // own subtasks are not duplicated: a copy is one task, not a tree.
    const parentRelations = (await manager.query(
      `SELECT r.source_task_id AS "parentTaskId",
         parent.project_id AS "parentProjectId", r.relation_type AS "relationType"
       FROM task_relation r
       INNER JOIN task parent ON r.source_task_id = parent.id
       INNER JOIN project p ON parent.project_id = p.id
       WHERE r.target_task_id = $1 AND p.workspace_id = $2
         AND r.relation_type = 'subtask'
         AND ${projectAccessCondition("$3", "parent.project_id")}`,
      [sourceTask.id, project.workspaceId, currentUserId],
    )) as ParentRelation[];

    if (parentRelations.length > 0 && !canUpdateTasks) {
      throw new HTTPException(403, {
        message: "Duplicating parent links requires task:update permission",
      });
    }

    // The destination object keys embed the new task id, so it is generated
    // up front instead of being left to the insert.
    const duplicatedTaskId = createId();

    const { assets, description } = await duplicateDescriptionAssets(
      manager,
      this.storage,
      { sourceTask, duplicatedTaskId, workspaceId: project.workspaceId },
    );

    let duplicated: { task: TaskRow; relations: TaskRelationEntity[] };
    try {
      duplicated = await this.dataSource.transaction(async (tx) => {
        const taskNumber = await claimTaskNumber(tx, sourceTask.projectId);
        const nextPosition = await nextTaskPosition(
          tx,
          sourceTask.projectId,
          sourceTask.status,
          columnId,
        );

        const task = await insertTask(tx, {
          id: duplicatedTaskId,
          projectId: sourceTask.projectId,
          userId: assigneeId,
          title: title?.trim() || sourceTask.title,
          status: sourceTask.status,
          columnId,
          startDate: sourceTask.startDate,
          dueDate: sourceTask.dueDate,
          description,
          priority: sourceTask.priority,
          number: taskNumber,
          position: nextPosition,
        });

        if (!task) {
          throw new HTTPException(500, {
            message: "Failed to duplicate task",
          });
        }

        await insertCustomFieldValues(
          tx,
          customFields.map((field) => ({ ...field, taskId: task.id })),
        );
        await this.insertLabels(tx, task.id, sourceLabels);
        await this.insertAssets(tx, assets);

        const relations: TaskRelationEntity[] = [];
        for (const relation of parentRelations) {
          const row = await insertReturning(tx, TaskRelationEntity, {
            sourceTaskId: relation.parentTaskId,
            targetTaskId: task.id,
            relationType: relation.relationType,
          });
          if (row) relations.push(row);
        }

        return { task, relations };
      });
    } catch (error) {
      await discardCopiedObjects(
        this.storage,
        assets.map((asset) => asset.objectKey),
      );
      throw error;
    }

    const duplicatedTask = duplicated.task;

    const [assignee] = duplicatedTask.userId
      ? ((await manager.query(`SELECT name FROM "user" WHERE id = $1`, [
          duplicatedTask.userId,
        ])) as { name: string }[])
      : [];

    await this.events.publish("task.created", {
      ...duplicatedTask,
      taskId: duplicatedTask.id,
      userId: duplicatedTask.userId ?? "",
      currentUserId,
      type: "created",
      content: null,
    });

    for (const relation of duplicated.relations) {
      const parentProjectId = parentRelations.find(
        (parentRelation) =>
          parentRelation.parentTaskId === relation.sourceTaskId,
      )?.parentProjectId;

      await this.events.publish("task-relation.created", {
        ...relation,
        taskId: relation.sourceTaskId,
        projectId: parentProjectId ?? sourceTask.projectId,
        userId: currentUserId,
      });
    }

    return {
      ...duplicatedTask,
      assigneeName: assignee?.name,
    };
  }

  /** The copy keeps the assignee only while they may still see the project. */
  private async copiedAssignee(
    manager: EntityManager,
    sourceTask: TaskRow,
    workspaceId: string,
  ): Promise<string | null> {
    const assigneeId = sourceTask.userId;
    if (!assigneeId) return null;
    const members = await filterAssignableUsers(
      manager,
      [assigneeId],
      workspaceId,
    );
    if (!members.has(assigneeId)) {
      throw new HTTPException(403, { message: NOT_ASSIGNABLE });
    }
    const permitted = await filterUsersWithProjectAccess(
      manager,
      [assigneeId],
      sourceTask.projectId,
    );
    return permitted.has(assigneeId) ? assigneeId : null;
  }

  /**
   * Older tasks may predate a required field. Apply its current default or
   * fail validation, just as creation does, before copying anything in
   * storage.
   */
  private async copiedCustomFields(
    manager: EntityManager,
    sourceTask: TaskRow,
  ): Promise<CustomFieldInput[]> {
    const fieldDefinitions = await findCustomFieldDefinitions(
      manager,
      sourceTask.projectId,
    );
    const sourceCustomFields = (await manager.query(
      `SELECT v.field_id AS "fieldId", v.value
       FROM custom_field_value v
       INNER JOIN custom_field_definition d ON v.field_id = d.id
       WHERE v.task_id = $1 AND d.project_id = $2`,
      [sourceTask.id, sourceTask.projectId],
    )) as { fieldId: string; value: string | null }[];
    const customFields = sourceCustomFields.map(({ fieldId, value }) => ({
      fieldId,
      value: value ?? "",
    }));
    for (const definition of fieldDefinitions) {
      if (!definition.required || !definition.defaultValue?.trim()) continue;
      const existing = customFields.find(
        (field) => field.fieldId === definition.id,
      );
      if (!existing)
        customFields.push({
          fieldId: definition.id,
          value: definition.defaultValue.trim(),
        });
      else if (!existing.value.trim())
        existing.value = definition.defaultValue.trim();
    }
    return customFields;
  }

  private async insertLabels(
    tx: EntityManager,
    taskId: string,
    labels: SourceLabel[],
  ) {
    if (!labels.length) return;
    await tx
      .createQueryBuilder()
      .insert()
      .into(LabelEntity)
      .values(
        labels.map((label) => ({
          id: createId(),
          name: label.name,
          color: label.color,
          taskId,
          workspaceId: label.workspaceId,
        })),
      )
      .updateEntity(false)
      .execute();
  }

  private async insertAssets(tx: EntityManager, assets: AssetCopy[]) {
    if (!assets.length) return;
    await tx
      .createQueryBuilder()
      .insert()
      .into(AssetEntity)
      .values(assets)
      .updateEntity(false)
      .execute();
  }
}
