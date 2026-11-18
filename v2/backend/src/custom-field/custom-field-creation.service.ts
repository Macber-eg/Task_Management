import { createId } from "@paralleldrive/cuid2";
import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { CustomFieldDefinitionEntity } from "../database/entities/custom-field-definition.entity";
import { CustomFieldValueEntity } from "../database/entities/custom-field-value.entity";
import { ProjectEntity } from "../database/entities/project.entity";
import { TaskEntity } from "../database/entities/task.entity";
import {
  type CustomFieldDefinitionInput,
  validateCustomFieldDefinition,
} from "./validate-custom-field-definition";

const BACKFILL_CHUNK_SIZE = 500;

/** Adds a field to a project and fills its default into existing tasks. */
@Injectable()
export class CustomFieldCreationService {
  constructor(private readonly dataSource: DataSource) {}

  async createCustomField(
    projectId: string,
    definition: CustomFieldDefinitionInput,
  ): Promise<CustomFieldDefinitionEntity> {
    const { name, type, required, defaultValue, options } = definition;
    if (!name.trim())
      throw new HTTPException(400, { message: "Name cannot be empty" });

    const manager = this.dataSource.manager;
    const project = await manager.findOne(ProjectEntity, {
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    validateCustomFieldDefinition(definition);

    const storedDefaultValue =
      type === "date" ? defaultValue?.trim() : defaultValue;

    const [maxPositionResult] = (await manager.query(
      `SELECT max(position) AS "maxPosition"
       FROM custom_field_definition WHERE project_id = $1`,
      [projectId],
    )) as { maxPosition: number | null }[];

    return this.dataSource.transaction(async (tx) => {
      const created = await insertReturning(tx, CustomFieldDefinitionEntity, {
        projectId,
        name,
        type,
        required,
        defaultValue: storedDefaultValue ?? null,
        options: options ?? null,
        position: (maxPositionResult?.maxPosition ?? 0) + 1,
      });

      if (!created) {
        throw new HTTPException(500, {
          message: "Failed to create custom field",
        });
      }

      if (storedDefaultValue != null && storedDefaultValue.trim() !== "") {
        const tasks = await tx.find(TaskEntity, {
          where: { projectId },
          select: { id: true },
        });

        for (let i = 0; i < tasks.length; i += BACKFILL_CHUNK_SIZE) {
          await tx
            .createQueryBuilder()
            .insert()
            .into(CustomFieldValueEntity)
            .values(
              tasks.slice(i, i + BACKFILL_CHUNK_SIZE).map((task) => ({
                id: createId(),
                taskId: task.id,
                fieldId: created.id,
                value: storedDefaultValue,
              })),
            )
            .orIgnore()
            .updateEntity(false)
            .execute();
        }
      }

      return created;
    });
  }
}
