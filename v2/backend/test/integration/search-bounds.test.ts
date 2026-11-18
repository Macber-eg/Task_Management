import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("short task ID search bounds", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("handles invalid int4 IDs without querying an overflowing task number", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "DEP",
    });
    await createTask(app.db, {
      projectId: project.id,
      title: "Boundary",
      number: 2_147_483_647,
    });
    app.auth.signIn(member.user);
    for (const number of [
      "2147483648",
      "999999999999999999999999999999",
      "9".repeat(400),
      "0",
    ]) {
      const response = await app.request(
        `/api/search?${new URLSearchParams({ q: `DEP-${number}`, workspaceId: member.workspace.id, type: "tasks" })}`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ results: [] });
    }
    const valid = await app.request(
      `/api/search?${new URLSearchParams({ q: "DEP-2147483647", workspaceId: member.workspace.id, type: "tasks" })}`,
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({
      results: [
        expect.objectContaining({
          title: "Boundary",
          taskNumber: 2_147_483_647,
        }),
      ],
    });
    const oversized = await app.request(
      `/api/search?${new URLSearchParams({ q: "9".repeat(513), workspaceId: member.workspace.id })}`,
    );
    expect(oversized.status).toBe(400);
  });
});
