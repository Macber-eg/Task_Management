import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createMember } from "../support/fixtures/create-member";
import { createRestrictedWorkspace } from "../support/fixtures/create-restricted-workspace";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The project, board and search parts of the previous "project access
// enforcement" tests. The task, comment, activity, time entry, relation,
// custom field and external link reads belong to other areas' tests.
describe("project access enforcement", () => {
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

  async function status(path: string) {
    return { path, status: (await app.request(`/api${path}`)).status };
  }

  it("lists only the projects a restricted member can access", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.restricted);

    const response = await app.request(
      `/api/project?workspaceId=${ctx.workspace.id}`,
    );

    expect(response.status).toBe(200);
    const projects = (await response.json()) as { id: string }[];
    expect(projects.map((project) => project.id)).toEqual([ctx.alpha.id]);
  });

  it("blocks every project-level read of a project outside the selection", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.restricted);

    for (const path of [
      `/project/${ctx.beta.id}`,
      `/column/${ctx.beta.id}`,
      `/workflow-rule/${ctx.beta.id}`,
      `/project-home/bookmarks/${ctx.beta.id}`,
      `/calendar-feed/project/${ctx.beta.id}`,
    ]) {
      expect(await status(path)).toEqual({ path, status: 403 });
    }

    for (const path of [
      `/project/${ctx.alpha.id}`,
      `/column/${ctx.alpha.id}`,
      `/workflow-rule/${ctx.alpha.id}`,
    ]) {
      expect(await status(path)).toEqual({ path, status: 200 });
    }
  });

  it("filters search", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.restricted);

    const search = await app.request(
      `/api/search?workspaceId=${ctx.workspace.id}&q=task&type=tasks`,
    );
    expect(search.status).toBe(200);
    const searchBody = JSON.stringify(await search.json());
    expect(searchBody).toContain("Visible alpha task");
    expect(searchBody).not.toContain("Hidden beta task");
  });

  it("leaves owners and unrestricted members unaffected", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const unrestricted = await createMember(app.db, ctx.workspace.id);

    for (const user of [ctx.owner, unrestricted]) {
      app.auth.signIn(user);
      const response = await app.request(
        `/api/project?workspaceId=${ctx.workspace.id}`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toHaveLength(2);
      expect((await status(`/project/${ctx.beta.id}`)).status).toBe(200);
    }
  });

  it("applies the member's project access to their API keys", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    app.auth.signInAs(await createApiKeyPrincipal(app.db, ctx.restricted));

    expect((await status(`/project/${ctx.beta.id}`)).status).toBe(403);
    expect((await status(`/project/${ctx.alpha.id}`)).status).toBe(200);
  });

  // The project-read half of "restricts a member and lifts the restriction
  // again" from the previous project access management tests.
  it("blocks and reopens the member's project reads as the restriction changes", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const member = await createMember(app.db, ctx.workspace.id);
    const putAccess = (body: Record<string, unknown>) =>
      app.request(
        `/api/workspace/${ctx.workspace.id}/members/${member.id}/project-access`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );

    app.auth.signIn(ctx.owner);
    expect(
      (
        await putAccess({
          projectAccess: "selected",
          projectIds: [ctx.beta.id],
        })
      ).status,
    ).toBe(200);

    app.auth.signIn(member);
    expect((await status(`/project/${ctx.alpha.id}`)).status).toBe(403);
    expect((await status(`/project/${ctx.beta.id}`)).status).toBe(200);

    app.auth.signIn(ctx.owner);
    expect((await putAccess({ projectAccess: "all" })).status).toBe(200);

    app.auth.signIn(member);
    expect((await status(`/project/${ctx.alpha.id}`)).status).toBe(200);
  });

  it("keeps a restricted member's access to projects they create", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.restricted);

    const created = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Gamma",
        workspaceId: ctx.workspace.id,
        icon: "Layout",
        slug: "gamma",
      }),
    });
    expect(created.status).toBe(200);
    const project = (await created.json()) as { id: string };

    expect((await status(`/project/${project.id}`)).status).toBe(200);
  });
});
