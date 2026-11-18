// Ported from the GitHub parts of tests/api-integration/authorization-boundaries.test.ts
// ("github integration routes are workspace scoped") and of
// tests/api-integration/tenant-resource-boundaries.test.ts (the label routes'
// GitHub label sync). The previous suite replaced `syncLabelToGitHub` /
// `removeLabelFromGitHub`; here the label routes reach the registered GitHub
// plugin through the real `LabelIntegrationSync`, and its label hooks are
// spied on. The Gitea assertions of those cases belong to the Gitea agent.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { GitHubPlugin } from "../../src/integrations/github/github.plugin";
import { LabelDeletionService } from "../../src/label/label-deletion.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GitHub route and label-sync boundaries", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.restoreAllMocks();
    double.reset();
  });

  describe("github integration routes are workspace scoped", () => {
    it("refuses to list repositories for a member without manage_settings", async () => {
      const { user, workspace } = await createWorkspaceMember(app.db, {
        role: "member",
      });
      const { project } = await createProjectFixture(app.db, {
        workspaceId: workspace.id,
      });
      app.auth.signIn(user);
      const response = await app.request(
        `/api/github-integration/repositories/${project.id}`,
      );
      expect(response.status).toBe(403);
    });

    it("refuses to verify an installation for a member without manage_settings", async () => {
      const { user, workspace } = await createWorkspaceMember(app.db, {
        role: "member",
      });
      const { project } = await createProjectFixture(app.db, {
        workspaceId: workspace.id,
      });
      app.auth.signIn(user);
      const response = await app.request("/api/github-integration/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          repositoryOwner: "usekaneo",
          repositoryName: "kaneo",
        }),
      });
      expect(response.status).toBe(403);
    });

    it("refuses to list repositories for a project in another workspace", async () => {
      const outsider = await createWorkspaceMember(app.db, { role: "owner" });
      const other = await createWorkspaceMember(app.db, { role: "owner" });
      const { project } = await createProjectFixture(app.db, {
        workspaceId: other.workspace.id,
      });
      app.auth.signIn(outsider.user);
      const response = await app.request(
        `/api/github-integration/repositories/${project.id}`,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("Project not found");
    });
  });

  describe("tenant resource boundaries (GitHub label sync)", () => {
    async function context() {
      const member = await createWorkspaceMember(app.db);
      const { project } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      const task = await createTask(app.db, {
        title: "Private task",
        projectId: project.id,
        number: 1,
      });
      return { ...member, project, task };
    }
    function request(path: string, method: string, body?: unknown) {
      return app.request(`/api${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
    }
    function label(workspaceId: string, taskId: string | null) {
      return insertRow(app.db, LabelEntity, {
        workspaceId,
        taskId,
        name: "bug",
        color: "#ff0000",
      });
    }
    function spies() {
      const plugin = app.get(GitHubPlugin);
      return {
        syncGithub: vi
          .spyOn(plugin, "syncTaskLabel")
          .mockResolvedValue(undefined),
        removeGithub: vi
          .spyOn(plugin, "removeTaskLabel")
          .mockResolvedValue(undefined),
        publish: vi
          .spyOn(app.get(EventBus), "publish")
          .mockResolvedValue(undefined),
      };
    }

    it("rejects foreign and nonexistent task IDs before creating or syncing a label", async () => {
      const { syncGithub, publish } = spies();
      const own = await context();
      const foreign = await context();
      app.auth.signIn(own.user);
      for (const taskId of [foreign.task.id, "missing-task"]) {
        const response = await request("/label", "POST", {
          name: "bug",
          color: "#ff0000",
          workspaceId: own.workspace.id,
          taskId,
        });
        expect(response.status).toBe(404);
        expect(await readErrorBody(response)).toMatchObject({
          message: "Task not found",
          code: "NOT_FOUND",
        });
      }
      expect(await app.db.find(LabelEntity)).toHaveLength(0);
      expect(syncGithub).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(
        (
          await request("/label", "POST", {
            name: "bug",
            color: "#ff0000",
            workspaceId: own.workspace.id,
            taskId: own.task.id,
          })
        ).status,
      ).toBe(200);
      expect(syncGithub).toHaveBeenCalledWith(own.task.id, "bug", "#ff0000");
    });

    it("rejects legacy cross-workspace label rows at every label-ID endpoint", async () => {
      const { syncGithub, removeGithub, publish } = spies();
      const own = await context();
      const foreign = await context();
      const forged = await label(own.workspace.id, foreign.task.id);
      app.auth.signIn(own.user);
      for (const [suffix, method, body] of [
        ["", "GET", undefined],
        ["", "DELETE", undefined],
        ["", "PUT", { name: "changed", color: "#ffffff" }],
        ["/task", "DELETE", undefined],
        ["/task", "PUT", { taskId: own.task.id }],
      ] as const) {
        const response = await request(
          `/label/${forged.id}${suffix}`,
          method,
          body,
        );
        expect(response.status).toBe(404);
        expect(await response.text()).toContain("Label not found");
      }
      await expect(
        app.get(LabelDeletionService).deleteLabel(forged.id, own.user.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(await app.db.find(LabelEntity)).toEqual([forged]);
      expect(syncGithub).not.toHaveBeenCalled();
      expect(removeGithub).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it("does not sync or publish foreign tasks when cleaning up a workspace label", async () => {
      const { removeGithub, publish } = spies();
      const own = await context();
      const foreign = await context();
      const root = await label(own.workspace.id, null);
      await label(own.workspace.id, own.task.id);
      await label(own.workspace.id, foreign.task.id);
      const untouched = await label(foreign.workspace.id, null);
      app.auth.signIn(own.user);
      expect((await request(`/label/${root.id}`, "DELETE")).status).toBe(200);
      expect(await app.db.find(LabelEntity)).toEqual([untouched]);
      expect(removeGithub.mock.calls).toEqual([[own.task.id, "bug"]]);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        "task.label_deleted",
        expect.objectContaining({ taskId: own.task.id }),
        { waitForHandlers: true },
      );
    });
  });
});
