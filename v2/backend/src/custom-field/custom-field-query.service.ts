import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CustomFieldDefinitionEntity } from "../database/entities/custom-field-definition.entity";

type CustomFieldValueRow = {
  id: string;
  taskId: string;
  fieldId: string;
  value: string | null;
  fieldName: string;
  fieldPosition: number;
  fieldType: string;
  fieldOptions: unknown;
};

const VALUE_COLUMNS = `v.id, v.task_id AS "taskId", v.field_id AS "fieldId",
  v.value, f.name AS "fieldName", f.position AS "fieldPosition",
  f.type AS "fieldType", f.options AS "fieldOptions"`;

/** Custom field definitions and the values tasks hold for them. */
@Injectable()
export class CustomFieldQueryService {
  constructor(private readonly dataSource: DataSource) {}

  getCustomFieldsByProject(
    projectId: string,
  ): Promise<CustomFieldDefinitionEntity[]> {
    return this.dataSource.manager.find(CustomFieldDefinitionEntity, {
      where: { projectId },
      order: { position: "ASC" },
    });
  }

  async getCustomFieldValuesByProject(
    projectId: string,
  ): Promise<CustomFieldValueRow[]> {
    return (await this.dataSource.query(
      `SELECT ${VALUE_COLUMNS}
       FROM custom_field_value AS v
       INNER JOIN task AS t ON v.task_id = t.id
       INNER JOIN custom_field_definition AS f ON v.field_id = f.id
       WHERE t.project_id = $1`,
      [projectId],
    )) as CustomFieldValueRow[];
  }

  async getCustomFieldValuesByTask(
    taskId: string,
  ): Promise<CustomFieldValueRow[]> {
    return (await this.dataSource.query(
      `SELECT ${VALUE_COLUMNS}
       FROM custom_field_value AS v
       INNER JOIN custom_field_definition AS f ON v.field_id = f.id
       WHERE v.task_id = $1`,
      [taskId],
    )) as CustomFieldValueRow[];
  }

  async getCustomFieldFilterValues(projectId: string) {
    const fields = await this.dataSource.manager.find(
      CustomFieldDefinitionEntity,
      { where: { projectId } },
    );

    if (fields.length === 0) {
      return [];
    }
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT field_id AS "fieldId", value
       FROM custom_field_value
       WHERE field_id = ANY($1::text[])
         AND value IS NOT NULL
         AND value <> ''`,
      [fields.map((field) => field.id)],
    )) as { fieldId: string; value: string }[];
    const valuesByField = new Map<string, string[]>();
    for (const row of rows) {
      const bucket = valuesByField.get(row.fieldId) ?? [];
      bucket.push(row.value);
      valuesByField.set(row.fieldId, bucket);
    }
    return fields.map((field) => ({
      fieldId: field.id,
      fieldName: field.name,
      fieldType: field.type,
      values: valuesByField.get(field.id) ?? [],
    }));
  }
}
