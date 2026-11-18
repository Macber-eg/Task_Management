import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("external comment attribution", () => {
  let app: TestApp;
  // Authenticates real API keys, like the previous test's unmocked session.
  let keyApp: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
    keyApp = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
    await keyApp.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  async function seededTask(role?: string) {
    const member = await createWorkspaceMember(app.db, { role });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Task",
      status: "to-do",
      number: 1,
    });
    return { ...member, task };
  }

  it.each(["planka", "trello", "jira"])(
    "blocks ordinary member impersonation through %s but allows their own comments",
    async (externalSource) => {
      const member = await seededTask();
      app.auth.signIn(member.user);
      const send = (body: object) =>
        app.request(`/api/comment/${member.task.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      expect(
        (
          await send({
            content: "Fake",
            externalUserName: "Executive",
            externalSource,
          })
        ).status,
      ).toBe(403);
      expect(await app.db.find(ActivityEntity)).toHaveLength(0);
      expect((await send({ content: "My comment" })).status).toBe(200);
      const [row] = await app.db.find(ActivityEntity);
      expect(row?.userId).toBe(member.user.id);
      expect(row?.externalUserName).toBeNull();
      expect(row?.externalSource).toBeNull();
    },
  );

  it.each([false, true])(
    "requires explicit import permission on an admin's API key (granted=%s)",
    async (granted) => {
      const member = await seededTask("admin");
      const { key } = await seedApiKey(app.db, member.user.id, {
        enabled: true,
        permissions: JSON.stringify({
          task: ["update"],
          ...(granted ? { workspace: ["manage_settings"] } : {}),
        }),
      });
      const response = await keyApp.request(`/api/comment/${member.task.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          content: "Imported",
          externalSource: "planka",
          externalUserName: "Historical Author",
        }),
      });
      expect(response.status).toBe(granted ? 200 : 403);
      const rows = await app.db.find(ActivityEntity);
      expect(rows).toHaveLength(granted ? 1 : 0);
      if (granted)
        expect(rows[0]).toMatchObject({
          userId: member.user.id,
          externalUserName: "Historical Author",
          externalSource: "planka",
        });
    },
  );
});
