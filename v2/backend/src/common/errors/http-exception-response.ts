import { ApiError, type ApiErrorBody } from "./api-error";
import { errorCodeForStatus } from "./error-code";
import type { HTTPException } from "./http-exception";

const FALLBACK_MESSAGE = "Request failed";

type CustomBody = { message?: unknown; code?: unknown; error?: unknown };

export type ErrorResponse = {
  status: number;
  headers: Record<string, string>;
  /** A JSON error body, or raw text passed through untouched. */
  body: ApiErrorBody | { raw: string; contentType: string };
};

function parseCustomBody(text: string, contentType: string) {
  if (!contentType.includes("json")) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as CustomBody)
      : null;
  } catch {
    return null;
  }
}

function errorBody(
  error: HTTPException,
  status: number,
  message: string,
  customCode?: unknown,
): ApiErrorBody {
  if (error instanceof ApiError) {
    return {
      message,
      code: error.code,
      ...(error.issues ? { issues: error.issues } : {}),
      ...(error.missingPermissions
        ? { missingPermissions: error.missingPermissions }
        : {}),
    };
  }
  return {
    message,
    code:
      typeof customCode === "string" ? customCode : errorCodeForStatus(status),
  };
}

function headersOf(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (key === "content-type" || key === "content-length") return;
    headers[key] = value;
  });
  return headers;
}

export async function httpExceptionResponse(
  error: HTTPException,
): Promise<ErrorResponse> {
  const res = error.res;
  if (!res) {
    return {
      status: error.status,
      headers: {},
      body: errorBody(error, error.status, error.message || FALLBACK_MESSAGE),
    };
  }

  const text = await res.clone().text();
  const contentType = res.headers.get("content-type") ?? "";
  const custom = parseCustomBody(text, contentType);
  // OAuth endpoints answer with their own `{ error, error_description }`
  // shape, which clients parse as-is.
  if (typeof custom?.error === "string") {
    return {
      status: res.status,
      headers: headersOf(res),
      body: { raw: text, contentType },
    };
  }

  const customMessage =
    typeof custom?.message === "string" ? custom.message : custom ? "" : text;

  return {
    status: res.status,
    headers: headersOf(res),
    body: errorBody(
      error,
      res.status,
      customMessage || error.message || FALLBACK_MESSAGE,
      custom?.code,
    ),
  };
}
