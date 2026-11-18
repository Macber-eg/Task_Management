import { apiErrorSchema } from "./api-error-schema";
import { z } from "./zod";

export const pagingNumber = (min: number, max: number, fallback?: number) => {
  const parsed = z
    .string()
    .regex(/^\d+$/, "Expected a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
  return fallback === undefined
    ? parsed.openapi({ type: "integer", minimum: min, maximum: max })
    : parsed.default(fallback).openapi({
        type: "integer",
        minimum: min,
        maximum: max,
        default: fallback,
      });
};

export const responseTimestamp = z
  .date()
  .openapi({ type: "string", format: "date-time" });

export const nullableResponseTimestamp = responseTimestamp
  .nullable()
  .openapi({ type: ["string", "null"], format: "date-time" });

export function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: apiErrorSchema } },
  };
}

export function jsonResponse<T extends z.ZodType>(
  description: string,
  schema: T,
) {
  return {
    description,
    content: { "application/json": { schema } },
  };
}
