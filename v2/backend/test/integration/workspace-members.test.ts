import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRestrictedWorkspace } from "../support/fixtures/create-restricted-workspace";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GET /api/workspace/{workspaceId}/members", () => {
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

  // Not in the previous suite, which only covered the project filter.
  it("lists every member with their role", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    await createWorkspaceMember(app.db, { userName: "Elsewhere" });
    app.auth.signIn(ctx.restricted);

    const response = await app.request(
      `/api/workspace/${ctx.workspace.id}/members`,
    );

    expect(response.status).toBe(200);
    const members = (await response.json()) as { id: string }[];
    expect(members.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        {
          id: ctx.owner.id,
          name: ctx.owner.name,
          email: ctx.owner.email,
          image: null,
          role: "owner",
        },
        {
          id: ctx.restricted.id,
          name: ctx.restricted.name,
          email: ctx.restricted.email,
          image: null,
          role: "member",
        },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  // From "only offers and accepts assignees who can see the project"; its
  // assignee half belongs to the task routes.
  it("only offers members who can see the project", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.owner);

    const members = await app.request(
      `/api/workspace/${ctx.workspace.id}/members?projectId=${ctx.beta.id}`,
    );
    expect(members.status).toBe(200);
    const memberIds = ((await members.json()) as { id: string }[]).map(
      (member) => member.id,
    );
    expect(memberIds).toContain(ctx.owner.id);
    expect(memberIds).not.toContain(ctx.restricted.id);

    app.auth.signIn(ctx.restricted);
    const peek = await app.request(
      `/api/workspace/${ctx.workspace.id}/members?projectId=${ctx.beta.id}`,
    );
    expect(peek.status).toBe(403);
    expect(await readErrorBody(peek)).toEqual({
      message: "You don't have access to this project",
      code: "FORBIDDEN",
    });
  });

  it("answers 404 for a project of another workspace and for a non-member", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const other = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.owner);

    const foreignProject = await app.request(
      `/api/workspace/${ctx.workspace.id}/members?projectId=${other.alpha.id}`,
    );
    expect(foreignProject.status).toBe(404);
    expect(await readErrorBody(foreignProject)).toEqual({
      message: "Project not found",
      code: "NOT_FOUND",
    });

    const foreignWorkspace = await app.request(
      `/api/workspace/${other.workspace.id}/members`,
    );
    expect(foreignWorkspace.status).toBe(404);
    expect(await readErrorBody(foreignWorkspace)).toEqual({
      message: "Workspace not found",
      code: "NOT_FOUND",
    });
  });
});
