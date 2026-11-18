import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error";
import { validationError } from "./validation-error";

const issues = [
  { path: ["title"], message: "Required" },
  { path: ["limit"], message: "Too big" },
];

describe("validationError", () => {
  it("builds a VALIDATION_ERROR listing every issue", () => {
    const error = validationError(issues, "json");

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      message: "title: Required",
      code: "VALIDATION_ERROR",
      issues: [
        { path: "body.title", message: "Required" },
        { path: "body.limit", message: "Too big" },
      ],
    });
  });

  it("keeps a fixed message while reporting the issues", () => {
    expect(validationError(issues, "query", "Fixed")).toMatchObject({
      message: "Fixed",
      issues: [
        { path: "query.title", message: "Required" },
        { path: "query.limit", message: "Too big" },
      ],
    });
  });
});
