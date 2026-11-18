import type { RouteConfig } from "@asteasolutions/zod-to-openapi";
import {
  applyDecorators,
  HttpCode,
  RequestMapping,
  RequestMethod,
  SetMetadata,
} from "@nestjs/common";
import type { z } from "./zod";

/**
 * `hide` keeps a route out of the OpenAPI document. `validationMessage`
 * replaces the message of the route's 400 validation errors.
 */
export type ApiRouteConfig = RouteConfig & {
  hide?: boolean;
  validationMessage?: string;
};

export const API_ROUTE_KEY = "api:route";

/**
 * Declares a route once: its OpenAPI description and the Zod schemas its
 * params, query and body are validated against. `path` is relative to the
 * controller and uses OpenAPI syntax (`/{id}`).
 */
export function createRoute<C extends ApiRouteConfig>(config: C): C {
  return config;
}

type Output<S> = S extends z.ZodType ? z.output<S> : unknown;

type RequestPart<C, K extends string> = C extends {
  request: Record<K, infer S>;
}
  ? Output<S>
  : Record<string, never>;

type BodyOf<C, M extends string> = C extends {
  request: { body: { content: Record<M, { schema: infer S }> } };
}
  ? Output<S>
  : undefined;

/** The validated request parts of a route, as the handler receives them. */
export type RouteInput<C extends ApiRouteConfig> = {
  param: RequestPart<C, "params">;
  query: RequestPart<C, "query">;
  header: RequestPart<C, "headers">;
  cookie: RequestPart<C, "cookies">;
  json: BodyOf<C, "application/json">;
  form: BodyOf<C, "multipart/form-data">;
};

const METHODS: Partial<Record<ApiRouteConfig["method"], RequestMethod>> = {
  get: RequestMethod.GET,
  post: RequestMethod.POST,
  put: RequestMethod.PUT,
  delete: RequestMethod.DELETE,
  patch: RequestMethod.PATCH,
  head: RequestMethod.HEAD,
  options: RequestMethod.OPTIONS,
};

export function toNestPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\{([^}]+)\}/g, ":$1");
}

/**
 * Maps a `createRoute` definition onto a controller method. Handlers answer
 * 200 unless they return `reply(status, body)`; Nest's default of 201 for
 * POST would change the contract.
 */
export function ApiRoute(config: ApiRouteConfig): MethodDecorator {
  const method = METHODS[config.method];
  if (method === undefined) {
    throw new Error(`Unsupported route method: ${config.method}`);
  }
  return applyDecorators(
    RequestMapping({ path: toNestPath(config.path), method }),
    HttpCode(200),
    SetMetadata(API_ROUTE_KEY, config),
  );
}
