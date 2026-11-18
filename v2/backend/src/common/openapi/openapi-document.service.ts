import {
  OpenApiGeneratorV31,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import { Injectable } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { DOCUMENTED_AUTH_PATHS } from "../../auth/openapi/documented-auth-paths";
import { apiErrorSchema } from "./api-error-schema";
import { API_ROUTE_KEY, type ApiRouteConfig } from "./route";

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
  "trace",
];

type Operation = { responses?: Record<string, unknown>; security?: unknown[] };

export const normalizeApiServerUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
};

function joinPath(prefix: string, path: string): string {
  const joined = `/${prefix}/${path}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

/** Builds the OpenAPI document from every `@ApiRoute` in the application. */
@Injectable()
export class OpenApiDocumentService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  build() {
    const registry = new OpenAPIRegistry();

    const apiKeyRateLimited = registry.registerComponent(
      "responses",
      "ApiKeyRateLimited",
      {
        description:
          "The API key exceeded its rate limit or usage quota. Wait the number of seconds in Retry-After before retrying. The X-RateLimit headers are sent only when the rate limit was hit.",
        headers: {
          "Retry-After": {
            description:
              "Seconds to wait before retrying. Omitted when an exhausted usage quota never refills.",
            schema: { type: "integer" },
          },
          "X-RateLimit-Limit": {
            description: "Requests the API key may make per window.",
            schema: { type: "integer" },
          },
          "X-RateLimit-Remaining": {
            description: "Requests left in the current window.",
            schema: { type: "integer" },
          },
          "X-RateLimit-Reset": {
            description: "Unix time in seconds when the current window resets.",
            schema: { type: "integer" },
          },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiError" },
          },
        },
      },
    );

    this.registerRoutes(registry);

    registry.registerComponent("securitySchemes", "bearerAuth", {
      type: "http",
      scheme: "bearer",
      description: "API key or session token (Bearer)",
    });
    registry.register("ApiError", apiErrorSchema);

    const document = new OpenApiGeneratorV31(
      registry.definitions,
    ).generateDocument({
      openapi: "3.1.0",
      info: {
        title: "Kaneo API",
        version: "1.0.0",
        description:
          "Kaneo Project Management API - Manage projects, tasks, labels, and more",
      },
      servers: [
        {
          url: normalizeApiServerUrl(
            process.env.KANEO_API_URL || "https://cloud.kaneo.app",
          ),
          description: "Kaneo API Server",
        },
      ],
      security: [{ bearerAuth: [] }],
    });

    document.paths = {
      ...document.paths,
      ...(structuredClone(DOCUMENTED_AUTH_PATHS) as typeof document.paths),
    };

    // Every authenticated route sits behind the same global auth guard, so
    // the shared 401 and 429 are added here rather than repeated on each
    // route. Routes that opt out declare `security: []` and are skipped.
    const paths = (document.paths ?? {}) as Record<
      string,
      Record<string, Operation>
    >;
    for (const operations of Object.values(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!HTTP_METHODS.includes(method) || !operation.responses) continue;
        if (
          Array.isArray(operation.security) &&
          operation.security.length === 0
        ) {
          continue;
        }
        operation.responses["401"] ??= {
          description: "Missing or invalid credentials",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApiError" },
            },
          },
        };
        operation.responses["429"] ??= apiKeyRateLimited.ref;
      }
    }

    return document;
  }

  private registerRoutes(registry: OpenAPIRegistry) {
    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      const controllerPath: unknown = Reflect.getMetadata(
        PATH_METADATA,
        metatype,
      );
      const prefix = Array.isArray(controllerPath)
        ? String(controllerPath[0] ?? "")
        : String(controllerPath ?? "");
      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        (...args: unknown[]) => unknown
      >;

      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (!handler) continue;
        const config = this.reflector.get<ApiRouteConfig | undefined>(
          API_ROUTE_KEY,
          handler,
        );
        if (!config || config.hide) continue;
        const {
          hide: _hide,
          validationMessage: _validationMessage,
          ...route
        } = config;
        registry.registerPath({
          ...route,
          path: joinPath(prefix, route.path),
        });
      }
    }
  }
}
