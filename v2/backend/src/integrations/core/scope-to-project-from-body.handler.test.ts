import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { ProjectAccessService } from "../../access/project-access.service";
import type { WorkspaceMembershipService } from "../../access/workspace-membership.service";
import type { ApiRequest } from "../../auth/principal";
import { ScopeToProjectFromBodyHandler } from "./scope-to-project-from-body.handler";

function handler(projects: { workspaceId: string }[]) {
  const membership = { validateWorkspaceAccess: vi.fn() };
  const projectAccess = { assertProjectAccess: vi.fn() };
  const dataSource = { query: vi.fn(async () => projects) };
  return {
    membership,
    projectAccess,
    rule: new ScopeToProjectFromBodyHandler(
      dataSource as unknown as DataSource,
      membership as unknown as WorkspaceMembershipService,
      projectAccess as unknown as ProjectAccessService,
    ),
  };
}

const request = (body: unknown, principal = true) =>
  ({
    body,
    principal: principal
      ? { userId: "user", apiKey: { id: "key" } }
      : undefined,
  }) as unknown as ApiRequest;

describe("scopeToProjectFromBody", () => {
  it("authorizes the body's project and sets the workspace", async () => {
    const { rule, membership, projectAccess } = handler([
      { workspaceId: "ws" },
    ]);
    const req = request({ projectId: "project" });
    await rule.check(req);
    expect(membership.validateWorkspaceAccess).toHaveBeenCalledWith(
      "user",
      "ws",
      "key",
      { notFoundMessage: "Project not found" },
    );
    expect(projectAccess.assertProjectAccess).toHaveBeenCalledWith(
      "user",
      "project",
    );
    expect(req.workspaceId).toBe("ws");
  });

  it.each([
    [request({}, false), 401, "Unauthorized"],
    [request({}), 400, "projectId is required"],
    [request({ projectId: 7 }), 400, "projectId is required"],
    [request({ projectId: "missing" }), 404, "Project not found"],
  ])("refuses %#", async (req, status, message) => {
    await expect(handler([]).rule.check(req)).rejects.toMatchObject({
      status,
      message,
    });
  });
});
