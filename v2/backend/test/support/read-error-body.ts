import { expect } from "vitest";
import type { ApiErrorBody } from "../../src/common/errors/api-error";

export async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  expect(response.headers.get("content-type")).toContain("application/json");
  return (await response.json()) as ApiErrorBody;
}
