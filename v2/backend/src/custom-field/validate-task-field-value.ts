import { HTTPException } from "../common/errors/http-exception";
import type { CustomFieldDefinitionEntity } from "../database/entities/custom-field-definition.entity";

function isMultiselectEmpty(value: string): boolean {
  if (!value || value.trim().length === 0) return true;

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}

function fail(message: string): never {
  throw new HTTPException(400, { message });
}

/** Rejects a (trimmed) value the field's type, options or `required` forbid. */
export function validateTaskFieldValue(
  field: CustomFieldDefinitionEntity,
  normalizedValue: string,
): void {
  if (field.required) {
    if (field.type === "multiselect") {
      if (isMultiselectEmpty(normalizedValue))
        fail("This custom field is required");
    } else if (normalizedValue.length === 0) {
      fail("This custom field is required");
    }
  }

  if (normalizedValue.length === 0) return;

  if (
    field.type === "dropdown" &&
    Array.isArray(field.options) &&
    !field.options.includes(normalizedValue)
  ) {
    fail("Invalid option for this custom field");
  }

  if (field.type === "number" && Number.isNaN(Number(normalizedValue))) {
    fail("Value must be a valid number");
  }

  if (
    field.type === "boolean" &&
    normalizedValue !== "true" &&
    normalizedValue !== "false"
  ) {
    fail("Value must be true or false");
  }

  if (field.type === "multiselect") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalizedValue);
    } catch {
      fail("Value must be a valid JSON array");
    }

    if (!Array.isArray(parsed)) {
      fail("Value must be a JSON array");
    }

    if (Array.isArray(field.options)) {
      const options = field.options as unknown[];
      const invalid = parsed.some(
        (v) => typeof v !== "string" || !options.includes(v),
      );
      if (invalid) fail("Invalid option(s) for this custom field");
    }
  }
}
