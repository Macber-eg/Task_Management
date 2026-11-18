import { HTTPException } from "../common/errors/http-exception";
import {
  isCustomFieldValueEmpty,
  validateCustomFieldValue,
} from "./custom-field-value-rules";

export type CustomFieldDefinitionInput = {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  options?: string[];
};

const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

function validateDefaultValue({
  name,
  type,
  defaultValue,
  options,
}: CustomFieldDefinitionInput) {
  const trimmedValue = defaultValue?.trim();
  if (!trimmedValue) return;

  if (type === "number") {
    const parsed = Number(trimmedValue);
    if (
      !NUMBER_PATTERN.test(trimmedValue) ||
      Number.isNaN(parsed) ||
      !Number.isFinite(parsed)
    ) {
      throw new HTTPException(400, {
        message: "Default value must be a valid number for number type fields",
      });
    }
  } else if (type === "boolean") {
    if (trimmedValue !== "true" && trimmedValue !== "false") {
      throw new HTTPException(400, {
        message:
          "Default value must be 'true' or 'false' for boolean type fields",
      });
    }
  } else if (type === "date") {
    const error = validateCustomFieldValue(trimmedValue, "date", name);
    if (error) {
      throw new HTTPException(400, { message: error });
    }
  } else if (type === "dropdown") {
    if (options && options.length > 0) {
      const normalizedOptions = options.map((opt) => opt.trim());
      if (!normalizedOptions.includes(trimmedValue)) {
        throw new HTTPException(400, {
          message: "Default value must be one of the dropdown options",
        });
      }
    }
  }
}

/** Rejects a definition whose options or default value cannot work. */
export function validateCustomFieldDefinition(
  input: CustomFieldDefinitionInput,
): void {
  const { name, type, required, defaultValue, options } = input;

  if (required && (defaultValue === undefined || defaultValue.trim() === "")) {
    throw new HTTPException(400, {
      message: "Required fields must have a default value",
    });
  }

  validateDefaultValue(input);

  if (type === "dropdown" && (!options || options.length < 1)) {
    throw new HTTPException(400, {
      message: "Dropdown fields must have at least one option",
    });
  }

  if (type === "multiselect") {
    const normalizedOptions = Array.from(
      new Set(
        (options ?? [])
          .map((opt) => opt.trim())
          .filter((opt) => opt.length > 0),
      ),
    );

    if (normalizedOptions.length < 2) {
      throw new HTTPException(400, {
        message: "Multiselect fields must have at least 2 options",
      });
    }
  }

  if (type === "multiselect" && defaultValue != null) {
    const empty = isCustomFieldValueEmpty(defaultValue, "multiselect");
    if (required && empty) {
      throw new HTTPException(400, {
        message: "Required fields must have a default value",
      });
    }
    if (!empty) {
      const error = validateCustomFieldValue(
        defaultValue,
        "multiselect",
        name,
        options,
      );
      if (error) {
        throw new HTTPException(400, { message: error });
      }
    }
  }
}
