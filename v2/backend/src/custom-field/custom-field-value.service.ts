import { createId } from "@paralleldrive/cuid2";
import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { CustomFieldDefinitionEntity } from "../database/entities/custom-field-definition.entity";
import { TaskEntity } from "../database/entities/task.entity";
import { validateTaskFieldValue } from "./validate-task-field-value";

type StoredValue = {
  id: string;
  taskId: string;
  fieldId: string;
  value: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Sets a task's value for one custom field. */
@Injectable()
export class CustomFieldValueService {
  constructor(private readonly dataSource: DataSource) {}

  async setCustomFieldValue(
    taskId: string,
    fieldId: string,
    value: string,
  ): Promise<StoredValue | undefined> {
    const manager = this.dataSource.manager;
    const task = await manager.findOne(TaskEntity, {
      where: { id: taskId },
      select: { projectId: true },
    });

    if (!task) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    const field = await manager.findOne(CustomFieldDefinitionEntity, {
      where: { id: fieldId },
    });

    if (!field || field.projectId !== task.projectId) {
      throw new HTTPException(404, {
        message: "Custom field not found",
      });
    }

    const normalizedValue = value.trim();
    validateTaskFieldValue(field, normalizedValue);

    // `updated_at` is only stamped when an existing value is overwritten; a
    // new row takes the column default.
    const [result] = (await manager.query(
      `INSERT INTO custom_field_value (id, task_id, field_id, value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, field_id)
       DO UPDATE SET value = excluded.value, updated_at = $5
       RETURNING id, task_id AS "taskId", field_id AS "fieldId", value,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [createId(), taskId, fieldId, normalizedValue, new Date()],
    )) as StoredValue[];

    return result;
  }
}
