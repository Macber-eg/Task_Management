import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import {
  type CustomFieldInput,
  findCustomFieldDefinitions,
} from "./custom-field-definitions";
import {
  isCustomFieldValueEmpty,
  validateCustomFieldValue,
} from "./custom-field-values";

export async function assertRequiredCustomFields(
  manager: EntityManager,
  projectId: string,
  customFields: CustomFieldInput[] = [],
): Promise<void> {
  const allFields = await findCustomFieldDefinitions(manager, projectId);

  const validFieldIds = new Set(allFields.map((f) => f.id));

  for (const cf of customFields) {
    if (!validFieldIds.has(cf.fieldId)) {
      throw new HTTPException(400, {
        message: `Field "${cf.fieldId}" does not belong to this project.`,
      });
    }
  }

  for (const cf of customFields) {
    const def = allFields.find((f) => f.id === cf.fieldId);
    if (!def) continue;

    if (isCustomFieldValueEmpty(cf.value, def.type)) {
      if (def.required) {
        throw new HTTPException(400, {
          message: `Custom field "${def.name}" is required to create a task.`,
        });
      }
      continue;
    }

    const error = validateCustomFieldValue(
      cf.value,
      def.type,
      def.name,
      def.options,
    );

    if (error) {
      throw new HTTPException(400, { message: error });
    }
  }

  const providedIds = new Set(
    customFields
      .filter((cf) => {
        const def = allFields.find((f) => f.id === cf.fieldId);
        if (!def) return false;
        return !isCustomFieldValueEmpty(cf.value, def.type);
      })
      .map((f) => f.fieldId),
  );

  for (const field of allFields.filter((f) => f.required)) {
    const isSatisfied =
      providedIds.has(field.id) ||
      (field.defaultValue != null &&
        !isCustomFieldValueEmpty(field.defaultValue, field.type));

    if (!isSatisfied) {
      throw new HTTPException(400, {
        message: `Custom field "${field.name}" is required to create a task.`,
      });
    }
  }
}
