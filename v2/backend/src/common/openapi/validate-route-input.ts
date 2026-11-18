import type { Request } from "express";
import { validationError } from "../errors/validation-error";
import type { ApiRouteConfig } from "./route";
import type { z } from "./zod";

export type ValidatedInput = {
  param: unknown;
  query: unknown;
  header: unknown;
  cookie: unknown;
  json: unknown;
  form: unknown;
};

function isZodSchema(value: unknown): value is z.ZodType {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

function parsePart(schema: unknown, value: unknown, target: string): unknown {
  if (!isZodSchema(schema)) return value;
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error.issues, target);
  return result.data;
}

function bodySchema(config: ApiRouteConfig, mediaType: string): unknown {
  const media = config.request?.body?.content[mediaType];
  return media && "schema" in media ? media.schema : undefined;
}

/**
 * Validates each request part against the route's schemas, in the order the
 * previous API did (query, params, headers, cookies, body), so a request
 * with several invalid parts reports the same one first.
 */
export function validateRouteInput(
  config: ApiRouteConfig,
  request: Request,
): ValidatedInput {
  const requestSchemas = config.request;
  const headers = Array.isArray(requestSchemas?.headers)
    ? undefined
    : requestSchemas?.headers;

  const query = parsePart(requestSchemas?.query, request.query, "query");
  const param = parsePart(requestSchemas?.params, request.params, "param");
  const header = parsePart(headers, request.headers, "header");
  const cookie = parsePart(
    requestSchemas?.cookies,
    (request as Request & { cookies?: unknown }).cookies ?? {},
    "cookie",
  );

  const body: unknown = request.body ?? {};
  const jsonSchema = bodySchema(config, "application/json");
  const formSchema = bodySchema(config, "multipart/form-data");

  return {
    query,
    param,
    header,
    cookie,
    json: jsonSchema ? parsePart(jsonSchema, body, "json") : undefined,
    form: formSchema ? parsePart(formSchema, body, "form") : undefined,
  };
}
