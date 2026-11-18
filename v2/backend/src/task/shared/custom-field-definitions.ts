import type { EntityManager } from "typeorm";
import type { CustomFieldType } from "./custom-field-values";

export type CustomFieldDefinition = {
  id: string;
  name: string;
  type: CustomFieldType;
  required: boolean;
  defaultValue: string | null;
  options: unknown;
};

export type CustomFieldInput = { fieldId: string; value: string };

export async function findCustomFieldDefinitions(
  manager: EntityManager,
  projectId: string,
): Promise<CustomFieldDefinition[]> {
  return (await manager.query(
    `SELECT id, name, type, required, default_value AS "defaultValue", options
     FROM custom_field_definition WHERE project_id = $1`,
    [projectId],
  )) as CustomFieldDefinition[];
}
