import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRuleEntity } from "../../src/database/entities/workflow-rule.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: workflow rules", () => {
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

  function upsert(projectId: string, body: Record<string, unknown>) {
    return app.request(`/api/workflow-rule/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates one rule per integration and event, then moves its column", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);
    const rule = {
      integrationType: "github",
      eventType: "pull_request.opened",
    };

    const created = await upsert(project.id, {
      ...rule,
      columnId: columns.inProgress.id,
    });
    expect(created.status).toBe(200);
    const createdRule = (await created.json()) as WorkflowRuleEntity;
    expect(createdRule).toMatchObject({
      projectId: project.id,
      ...rule,
      columnId: columns.inProgress.id,
    });

    const updated = await upsert(project.id, {
      ...rule,
      columnId: columns.inReview.id,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: createdRule.id,
      columnId: columns.inReview.id,
    });

    const list = await app.request(`/api/workflow-rule/${project.id}`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([
      expect.objectContaining({
        id: createdRule.id,
        columnId: columns.inReview.id,
        columnName: "In Review",
        columnSlug: "in-review",
      }),
    ]);

    const deleted = await app.request(`/api/workflow-rule/${createdRule.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ id: createdRule.id });
    expect(await app.db.count(WorkflowRuleEntity)).toBe(0);

    const missing = await app.request(`/api/workflow-rule/${createdRule.id}`, {
      method: "DELETE",
    });
    expect(missing.status).toBe(404);
    expect(await readErrorBody(missing)).toMatchObject({
      message: "Workflow rule not found",
    });
  });

  it("refuses a column from another project", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const other = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);

    const response = await upsert(project.id, {
      integrationType: "github",
      eventType: "push",
      columnId: other.columns.done.id,
    });
    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Column does not belong to the provided project",
    });
  });

  it("requires project:update to change rules", async () => {
    const member = await createWorkspaceMember(app.db, { role: "member" });
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);

    const response = await upsert(project.id, {
      integrationType: "github",
      eventType: "push",
      columnId: columns.done.id,
    });
    expect(response.status).toBe(403);
    expect((await app.request(`/api/workflow-rule/${project.id}`)).status).toBe(
      200,
    );
  });
});
