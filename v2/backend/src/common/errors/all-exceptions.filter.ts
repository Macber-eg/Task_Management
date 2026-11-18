import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { errorCodeForStatus } from "./error-code";
import { HTTPException } from "./http-exception";
import {
  type ErrorResponse,
  httpExceptionResponse,
} from "./http-exception-response";

const INTERNAL_ERROR = "Internal Server Error";

type StatusCarrier = { status?: unknown; statusCode?: unknown; type?: unknown };

function isApiPath(path: string) {
  return path === "/api" || path.startsWith("/api/");
}

/** Status of errors raised by Express middleware (http-errors shape). */
function middlewareStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { status, statusCode } = error as StatusCarrier;
  const value = typeof status === "number" ? status : statusCode;
  return typeof value === "number" && value >= 400 && value < 600
    ? value
    : undefined;
}

function plainError(status: number, message: string): ErrorResponse {
  return {
    status,
    headers: {},
    body: { message, code: errorCodeForStatus(status) },
  };
}

/**
 * Turns every failure into the API's one error shape:
 * `{ message, code, issues?, missingPermissions? }`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    void this.resolve(exception, request)
      .catch((error: unknown) => {
        this.logger.error("Failed to build an error response", error);
        return plainError(500, INTERNAL_ERROR);
      })
      .then((result) => this.send(response, request, result));
  }

  private async resolve(
    exception: unknown,
    request: Request,
  ): Promise<ErrorResponse | "text-not-found"> {
    if (exception instanceof HTTPException) {
      if (exception.status >= 500) this.report(exception, request);
      return httpExceptionResponse(exception);
    }

    // Nest raises its own NotFoundException only for unmatched routes;
    // application code throws HTTPException.
    if (exception instanceof NotFoundException) {
      // `request.path` is relative to the router Nest mounts under the
      // global prefix, so the prefix is only visible on the original URL.
      return isApiPath(request.originalUrl.split("?")[0] ?? "")
        ? plainError(404, "Not found")
        : "text-not-found";
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) this.report(exception, request);
      return plainError(status, exception.message || "Request failed");
    }

    const status = middlewareStatus(exception);
    if (status !== undefined && status < 500) {
      const message =
        exception instanceof Error && exception.message
          ? exception.message
          : "Request failed";
      return plainError(status, message);
    }

    this.report(exception, request);
    return plainError(500, INTERNAL_ERROR);
  }

  private report(exception: unknown, request: Request) {
    this.logger.error(
      `${request.method} ${request.path} failed`,
      exception instanceof Error ? exception.stack : String(exception),
    );
  }

  private send(
    response: Response,
    request: Request,
    result: ErrorResponse | "text-not-found",
  ) {
    if (response.headersSent) return;
    if (result === "text-not-found") {
      response.status(404).type("text/plain").send("404 Not Found");
      return;
    }

    response.status(result.status).set(result.headers);
    if ("raw" in result.body) {
      response
        .type(result.body.contentType || "application/json")
        .send(result.body.raw);
      return;
    }
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    response.json(result.body);
  }
}
