import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error";
import { HTTPException } from "./http-exception";
import { httpExceptionResponse } from "./http-exception-response";

describe("httpExceptionResponse", () => {
  it("turns a plain HTTPException into a JSON body with a derived code", async () => {
    const response = await httpExceptionResponse(
      new HTTPException(404, { message: "Task not found" }),
    );

    expect(response).toEqual({
      status: 404,
      headers: {},
      body: { message: "Task not found", code: "NOT_FOUND" },
    });
  });

  it("keeps the specific code and details of an ApiError", async () => {
    const response = await httpExceptionResponse(
      new ApiError(403, {
        message: "Insufficient permissions",
        code: "MISSING_PERMISSION",
        missingPermissions: ["task:update"],
      }),
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: "Insufficient permissions",
      code: "MISSING_PERMISSION",
      missingPermissions: ["task:update"],
    });
  });

  it("converts a text response body and keeps its headers", async () => {
    const response = await httpExceptionResponse(
      new HTTPException(429, {
        res: new Response("Label deletion is busy; retry this request", {
          status: 429,
          headers: { "Retry-After": "1" },
        }),
      }),
    );

    expect(response.status).toBe(429);
    // The text content type is dropped: the body is sent as JSON.
    expect(response.headers).toEqual({ "retry-after": "1" });
    expect(response.body).toEqual({
      message: "Label deletion is busy; retry this request",
      code: "RATE_LIMITED",
    });
  });

  it("standardizes a JSON response that carries a message", async () => {
    const response = await httpExceptionResponse(
      new HTTPException(400, {
        res: Response.json(
          { message: "Use the comment endpoint" },
          { status: 400 },
        ),
      }),
    );

    expect(response.body).toEqual({
      message: "Use the comment endpoint",
      code: "BAD_REQUEST",
    });
  });

  it("passes an OAuth error response through untouched", async () => {
    const payload = {
      error: "temporarily_unavailable",
      error_description: "Retry later",
    };
    const response = await httpExceptionResponse(
      new HTTPException(429, {
        res: Response.json(payload, {
          status: 429,
          headers: { "Retry-After": "60" },
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers).toEqual({ "retry-after": "60" });
    expect(response.body).toEqual({
      raw: JSON.stringify(payload),
      contentType: expect.stringContaining("application/json"),
    });
  });

  it("falls back to a generic message for an empty body", async () => {
    const response = await httpExceptionResponse(
      new HTTPException(418, { res: new Response(null, { status: 418 }) }),
    );

    expect(response.body).toEqual({
      message: "Request failed",
      code: "HTTP_418",
    });
  });
});
