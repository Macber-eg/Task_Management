// Ported from tests/api-integration/integration-import-permissions.test.ts (GitHub cases).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("github and gitea import permissions", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    double.reset();
  });

  it("github denies a create-only custom role", async () => {
    const member = await createWorkspaceMember(app.db, { role: "importer" });
    await addWorkspaceRole(app.db, member.workspace.id, "importer", {
      task: ["create"],
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);
    const response = await app.request("/api/github-integration/import-issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });
    expect(response.status).toBe(403);
    expect(double.github.verifiedInstallationOctokit).not.toHaveBeenCalled();
    expect(double.octokit.graphql).not.toHaveBeenCalled();
  });

  // The Gitea/GitLab cases are in test/integration/gitea-integration-routes.test.ts.
});
