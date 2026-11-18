/**
 * A minimal re-implementation of the valibot subset the previous backend used
 * for integration configs, so validation errors keep their exact wording and
 * order (`Invalid type: Expected string but received undefined`, custom
 * messages, every pipe action reporting after the first failure, and checks
 * that throw propagating to the caller).
 */

type Dataset = { value: unknown; typed: boolean; issues?: string[] };

export type ConfigSchema = {
  kind: "schema";
  optional?: boolean;
  run(value: unknown): Dataset;
};

type Action = {
  kind: "validation" | "transformation";
  run(dataset: Dataset): Dataset;
};

export class ConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues[0] ?? "Invalid config");
  }
}

export function stringify(input: unknown): string {
  const type = typeof input;
  if (type === "string") return `"${input as string}"`;
  if (type === "number" || type === "bigint" || type === "boolean")
    return `${input as number}`;
  if (type === "object" || type === "function")
    return (
      ((input &&
        (Object.getPrototypeOf(input) as { constructor?: { name?: string } })
          ?.constructor?.name) as string | undefined) ?? "null"
    );
  return type;
}

function issue(
  label: string,
  expected: string | null,
  received: string,
): string {
  return `Invalid ${label}: ${expected ? `Expected ${expected} but r` : "R"}eceived ${received}`;
}

function primitive(
  expects: string,
  accepts: (value: unknown) => boolean,
): ConfigSchema {
  return {
    kind: "schema",
    run(value) {
      if (accepts(value)) return { value, typed: true };
      return {
        value,
        typed: false,
        issues: [issue("type", expects, stringify(value))],
      };
    },
  };
}

export const string = () =>
  primitive("string", (value) => typeof value === "string");
export const number = () =>
  primitive(
    "number",
    (value) => typeof value === "number" && !Number.isNaN(value),
  );
export const boolean = () =>
  primitive("boolean", (value) => typeof value === "boolean");

export function optional(wrapped: ConfigSchema): ConfigSchema {
  return {
    kind: "schema",
    optional: true,
    run(value) {
      if (value === undefined) return { value, typed: true };
      return wrapped.run(value);
    },
  };
}

/** Keeps only the declared keys present in the input, in declaration order. */
export function object(entries: Record<string, ConfigSchema>): ConfigSchema {
  return {
    kind: "schema",
    run(input) {
      if (!input || typeof input !== "object") {
        return {
          value: input,
          typed: false,
          issues: [issue("type", "Object", stringify(input))],
        };
      }
      const source = input as Record<string, unknown>;
      const dataset: Dataset = { value: {}, typed: true };
      const output = dataset.value as Record<string, unknown>;
      for (const [key, schema] of Object.entries(entries)) {
        if (key in source) {
          const result = schema.run(source[key]);
          if (result.issues)
            dataset.issues = [...(dataset.issues ?? []), ...result.issues];
          if (!result.typed) dataset.typed = false;
          output[key] = result.value;
        } else if (!schema.optional) {
          dataset.issues = [
            ...(dataset.issues ?? []),
            issue("key", `"${key}"`, "undefined"),
          ];
          dataset.typed = false;
        }
      }
      return dataset;
    },
  };
}

export function pipe(schema: ConfigSchema, ...actions: Action[]): ConfigSchema {
  return {
    kind: "schema",
    run(value) {
      let dataset = schema.run(value);
      for (const action of actions) {
        if (dataset.issues && action.kind === "transformation") {
          dataset.typed = false;
          break;
        }
        dataset = action.run(dataset);
      }
      return dataset;
    },
  };
}

function validation(
  passes: (value: never) => boolean,
  report: (value: never) => string,
): Action {
  return {
    kind: "validation",
    run(dataset) {
      if (dataset.typed && !passes(dataset.value as never)) {
        dataset.issues = [
          ...(dataset.issues ?? []),
          report(dataset.value as never),
        ];
      }
      return dataset;
    },
  };
}

export const regex = (pattern: RegExp, message: string) =>
  validation(
    (value: string) => pattern.test(value),
    () => message,
  );

export const url = () =>
  validation(
    (value: string) => URL.canParse(value),
    (value: string) => issue("URL", null, stringify(value)),
  );

/** Like valibot's `check`: a throwing requirement propagates to the caller. */
export const check = (requirement: (value: string) => boolean, message: string) =>
  validation(requirement, () => message);

export const integer = () =>
  validation(
    (value: number) => Number.isInteger(value),
    (value: number) => issue("integer", null, stringify(value)),
  );

export const minValue = (minimum: number) =>
  validation(
    (value: number) => value >= minimum,
    (value: number) => issue("value", `>=${minimum}`, stringify(value)),
  );

export const maxValue = (maximum: number) =>
  validation(
    (value: number) => value <= maximum,
    (value: number) => issue("value", `<=${maximum}`, stringify(value)),
  );

export const minLength = (minimum: number, message: string) =>
  validation(
    (value: string) => value.length >= minimum,
    () => message,
  );

export const trim = (): Action => ({
  kind: "transformation",
  run(dataset) {
    return { ...dataset, value: (dataset.value as string).trim() };
  },
});

/** Returns the schema's output, or throws `ConfigValidationError`. */
export function parse<T>(schema: ConfigSchema, input: unknown): T {
  const dataset = schema.run(input);
  if (dataset.issues) throw new ConfigValidationError(dataset.issues);
  return dataset.value as T;
}
