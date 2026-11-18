import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyKeyPrefix,
  buildObjectKey,
  buildObjectKeyPrefix,
  buildProjectBackgroundObjectKey,
  buildProjectBackgroundObjectKeyPrefix,
  buildStorageObjectKey,
  getFileExtension,
  sanitizePathSegment,
} from "./object-keys";

describe("object keys", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sanitizes path segments and extracts normalized extensions", () => {
    expect(sanitizePathSegment(" Release Notes!!.PNG ")).toBe(
      "release-notes-.png",
    );
    expect(sanitizePathSegment("")).toBe("file");
    expect(sanitizePathSegment("../../etc")).toBe("..-..-etc");
    expect(getFileExtension("Screenshot.Final.PNG")).toBe("png");
    expect(getFileExtension("README")).toBe("file");
  });

  it("builds stable key prefixes and keys", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_717_171_717_000);
    const scope = {
      workspaceId: "Workspace 1",
      projectId: "Project 2",
      taskId: "Task 3",
      surface: "comment" as const,
    };

    expect(buildObjectKeyPrefix(scope)).toBe(
      "workspace/workspace-1/project/project-2/task/task-3/comments",
    );
    expect(
      buildObjectKey({ ...scope, filename: "Sprint Plan Final!!.PNG" }),
    ).toMatch(
      /^workspace\/workspace-1\/project\/project-2\/task\/task-3\/comments\/sprint-plan-final-1717171717000-[a-z0-9]+\.png$/,
    );
    expect(
      buildObjectKey({ ...scope, surface: "description", filename: "noext" }),
    ).toMatch(/\/descriptions\/noext-1717171717000-[a-z0-9]+\.file$/);
  });

  it("applyKeyPrefix prepends prefix and trims trailing slashes", () => {
    expect(applyKeyPrefix("", "workspace/a/file.png")).toBe(
      "workspace/a/file.png",
    );
    expect(applyKeyPrefix("staging", "workspace/a/file.png")).toBe(
      "staging/workspace/a/file.png",
    );
    expect(applyKeyPrefix("prod/kaneo/", "workspace/a/file.png")).toBe(
      "prod/kaneo/workspace/a/file.png",
    );
    expect(applyKeyPrefix("prefix///", "key")).toBe("prefix/key");
  });

  it("applies S3_KEY_PREFIX to new task asset keys", () => {
    vi.stubEnv("S3_KEY_PREFIX", "kaneo-assets");
    expect(
      buildStorageObjectKey({
        workspaceId: "w1",
        projectId: "p1",
        taskId: "t1",
        surface: "description",
        filename: "report.png",
      }),
    ).toMatch(
      /^kaneo-assets\/workspace\/w1\/project\/p1\/task\/t1\/descriptions\/report-\d+-[a-z0-9]+\.png$/,
    );
  });

  it("builds project background keys inside the project scope", () => {
    const context = { workspaceId: "Workspace 1", projectId: "Project 2" };
    const { rawKey, version } = buildProjectBackgroundObjectKey(context);

    expect(buildProjectBackgroundObjectKeyPrefix(context)).toBe(
      "workspace/workspace-1/project/project-2/backgrounds",
    );
    expect(rawKey).toBe(
      `workspace/workspace-1/project/project-2/backgrounds/background-${version}`,
    );
    expect(version).toMatch(/^[a-z0-9]+$/);
  });
});
