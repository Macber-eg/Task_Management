import { In, IsNull } from "typeorm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ImportRunEntity } from "../../src/database/entities/import-run.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { NotificationEntity } from "../../src/database/entities/notification.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { TaskRelationEntity } from "../../src/database/entities/task-relation.entity";
import { WorkspaceMemberAccessEntity } from "../../src/database/entities/workspace-member-access.entity";
import { WorkspaceMemberProjectEntity } from "../../src/database/entities/workspace-member-project.entity";
import { ActiveImports } from "../../src/import/active-imports";
import { writeImportRelations } from "../../src/import/writer/write-import-relations";
import type {
  ImportedProject,
  ImportSource,
  ReadProjectOptions,
} from "../../src/importers";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const importers = vi.hoisted(() => ({ connectSource: vi.fn() }));
vi.mock("../../src/importers", async (original) => ({
  ...(await original<typeof import("../../src/importers")>()),
  connectSource: importers.connectSource,
}));

vi.mock("../../src/import/writer/write-import-relations", async (original) => {
  const actual =
    await original<
      typeof import("../../src/import/writer/write-import-relations")
    >();
  return {
    ...actual,
    writeImportRelations: vi.fn(actual.writeImportRelations),
  };
});

const SECRET = "planka-secret-key-0123456789";

const connection = {
  source: "planka",
  url: "https://planka.example.com",
  apiKey: SECRET,
};

function plankaProject(memberEmail: string): ImportedProject {
  return {
    name: "Website Relaunch",
    description: "Everything for the relaunch",
    columns: [
      { key: "c1", name: "Backlog", isFinal: false },
      { key: "c2", name: "Doing", isFinal: false },
      { key: "c3", name: "Shipped", isFinal: true },
      { key: "c4", name: "Planned", isFinal: false },
    ],
    labels: [
      { key: "l1", name: "Bug", color: "red" },
      { key: "l2", name: "Design", color: "purple" },
      { key: "l3", name: "Unused", color: "gray" },
    ],
    tasks: [
      {
        key: "t1",
        columnKey: "c1",
        title: "Write the copy",
        description: "Draft **all** pages",
        priority: "high",
        createdAt: "2023-05-06T07:08:09.000Z",
        dueDate: "2024-02-01T00:00:00.000Z",
        assignee: { name: "Mira", email: memberEmail.toUpperCase() },
        labelKeys: ["l1", "l2", "l1"],
        comments: [
          {
            author: { name: "Ana" },
            body: "Looks good",
            createdAt: "2024-01-02T03:04:05.000Z",
          },
          { author: {}, body: "No author" },
          { author: { name: "Empty" }, body: "   " },
        ],
      },
      {
        key: "t2",
        columnKey: "c1",
        title: "   ",
        description: "",
        priority: "bogus" as ImportedProject["tasks"][number]["priority"],
        assignee: { name: "Stranger", email: "stranger@example.com" },
        labelKeys: [],
        comments: [],
      },
      {
        key: "t3",
        columnKey: null,
        title: "Someday",
        description: "",
        priority: "low",
        labelKeys: [],
        comments: [],
      },
      {
        key: "t4",
        columnKey: "c3",
        archived: true,
        title: "Old launch",
        description: "",
        priority: "no-priority",
        labelKeys: [],
        comments: [],
      },
      {
        key: "t5",
        columnKey: "c3",
        title: "Ship it",
        description: "",
        priority: "urgent",
        labelKeys: ["l1"],
        comments: [],
      },
    ],
    relations: [
      { sourceKey: "t1", targetKey: "t5", type: "subtask" },
      { sourceKey: "t5", targetKey: "t1", type: "subtask" },
      { sourceKey: "t2", targetKey: "t2", type: "related" },
      { sourceKey: "t1", targetKey: "t3", type: "blocks" },
    ],
    warnings: ["2 attachments were skipped."],
  };
}

function numberedProject(): ImportedProject {
  const task = (key: string, title: string, number?: number) => ({
    key,
    ...(number === undefined ? {} : { number }),
    columnKey: "c1",
    title,
    description: "",
    priority: "no-priority" as const,
    labelKeys: [],
    comments: [],
  });
  return {
    name: "Engineering",
    key: "eng",
    columns: [{ key: "c1", name: "To Do", isFinal: false }],
    labels: [],
    tasks: [
      task("a", "Seven", 7),
      task("b", "No number"),
      task("c", "Three", 3),
      task("d", "Another seven", 7),
    ],
    relations: [],
    warnings: [],
  };
}

function fakeSource(
  read: (id: string, options: ReadProjectOptions) => Promise<ImportedProject>,
): ImportSource {
  return {
    listProjects: vi.fn(async () => [
      { id: "p1", name: "Website Relaunch", detail: "Marketing" },
      { id: "p2", name: "Broken board" },
    ]),
    readProject: vi.fn(read),
  };
}

class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SourceHttpError";
  }
}

const emptyCounts = {
  columns: 0,
  tasks: 0,
  labels: 0,
  comments: 0,
  assignees: 0,
  relations: 0,
};

describe("API integration: import from other tools", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    importers.connectSource.mockReset();
    app.auth.signOut();
  });

  function waitForActiveImports() {
    return app.get(ActiveImports).waitForAll();
  }

  function createAdmin() {
    return createWorkspaceMember(app.db, {
      role: "admin",
      userName: "Importer",
    });
  }

  async function addMember(
    workspaceId: string,
    name: string,
    role = "member",
  ) {
    const user = await createUser(app.db, { name });
    await addWorkspaceMember(app.db, workspaceId, user.id, role);
    return user;
  }

  function post(path: string, body: unknown) {
    return app.request(`/api/import${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function get(path: string) {
    return app.request(`/api/import${path}`);
  }

  async function importProject(workspaceId: string) {
    const started = await post("/runs", {
      workspaceId,
      connection,
      projectIds: ["p1"],
    });
    expect(started.status).toBe(202);
    const { run } = (await started.json()) as { run: { id: string } };
    await waitForActiveImports();

    const polled = await get(`/runs/${workspaceId}/${run.id}`);
    const { run: finished } = (await polled.json()) as {
      run: {
        projects: {
          status: string;
          projectId: string | null;
          projectSlug: string | null;
        }[];
      };
    };
    const [imported] = finished.projects;
    expect(imported?.status).toBe("completed");
    return imported as { projectId: string; projectSlug: string };
  }

  it("lists the projects of a source without echoing credentials", async () => {
    const admin = await createAdmin();
    importers.connectSource.mockResolvedValue(
      fakeSource(async () => plankaProject("")),
    );
    app.auth.signIn(admin.user);

    const response = await post("/projects", {
      workspaceId: admin.workspace.id,
      connection,
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      projects: [
        { id: "p1", name: "Website Relaunch", detail: "Marketing" },
        { id: "p2", name: "Broken board" },
      ],
    });
    expect(text).not.toContain(SECRET);
    expect(importers.connectSource).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        fetch: expect.any(Function),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("explains rejected credentials", async () => {
    const admin = await createAdmin();
    importers.connectSource.mockRejectedValue(
      new SourceHttpError(`PLANKA /api/users/me: unauthorized ${SECRET}`, 401),
    );
    app.auth.signIn(admin.user);

    const response = await post("/projects", {
      workspaceId: admin.workspace.id,
      connection,
    });

    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.message).toBe(
      "Could not sign in to PLANKA. Check the API key.",
    );
  });

  it("asks for a Trello API key when the server has none", async () => {
    vi.stubEnv("TRELLO_API_KEY", "");
    const admin = await createAdmin();
    app.auth.signIn(admin.user);

    try {
      const response = await post("/projects", {
        workspaceId: admin.workspace.id,
        connection: { source: "trello", token: "trello-token-123456" },
      });

      expect(response.status).toBe(400);
      expect((await readErrorBody(response)).message).toBe(
        "Add a Trello API key.",
      );
      expect(importers.connectSource).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("imports projects in the background and reports each one", async () => {
    const admin = await createAdmin();
    const workspaceId = admin.workspace.id;
    const member = await addMember(workspaceId, "Mira");
    await insertRow(app.db, LabelEntity, {
      name: "Bug",
      color: "#123456",
      workspaceId,
      taskId: null,
    });
    const source = fakeSource(async (id, options) => {
      options.onProgress?.("Reading cards (1 of 5)");
      if (id === "p2") {
        throw new SourceHttpError("PLANKA /api/boards/p2: boom", 500);
      }
      expect(options.includeComments).toBe(true);
      return plankaProject(member.email);
    });
    importers.connectSource.mockResolvedValue(source);
    app.auth.signIn(admin.user);

    const started = await post("/runs", {
      workspaceId,
      connection,
      projectIds: ["p2", "p1"],
    });
    expect(started.status).toBe(202);
    const { run } = (await started.json()) as {
      run: { id: string; status: string; projects: { name: string }[] };
    };
    expect(run.status).toBe("running");
    expect(run.projects.map((project) => project.name)).toEqual([
      "Broken board",
      "Website Relaunch",
    ]);

    await waitForActiveImports();

    const polled = await get(`/runs/${workspaceId}/${run.id}`);
    expect(polled.status).toBe(200);
    const { run: finished } = (await polled.json()) as {
      run: {
        status: string;
        error: string | null;
        message: string | null;
        finishedAt: string | null;
        projects: {
          sourceId: string;
          status: string;
          projectId: string | null;
          projectSlug: string | null;
          counts: Record<string, number>;
          warnings: string[];
          error: string | null;
        }[];
      };
    };
    expect(finished).toMatchObject({
      status: "completed",
      error: null,
      message: null,
    });
    expect(finished.finishedAt).not.toBeNull();
    const [broken, imported] = finished.projects;
    expect(broken).toMatchObject({
      sourceId: "p2",
      status: "failed",
      projectId: null,
      error: "PLANKA returned an error (HTTP 500). Try again later.",
    });
    expect(imported).toMatchObject({
      sourceId: "p1",
      status: "completed",
      projectSlug: "WR",
      error: null,
      counts: {
        columns: 4,
        tasks: 5,
        labels: 2,
        comments: 2,
        assignees: 1,
        relations: 2,
      },
    });
    expect(imported?.warnings).toEqual([
      "2 attachments were skipped.",
      'Renamed a column to avoid conflicts: "Planned" to "Planned list".',
      "1 task was assigned to someone who is not a member of this workspace (Stranger). Invite them, then assign the task.",
    ]);

    const projectId = imported?.projectId ?? "";
    const projects = await app.db.find(ProjectEntity, {
      where: { workspaceId },
    });
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: projectId,
      name: "Website Relaunch",
      slug: "WR",
      description: "Everything for the relaunch",
      lastTaskNumber: 5,
    });

    const columns = await app.db.find(ColumnEntity, {
      where: { projectId },
      order: { position: "ASC" },
    });
    expect(
      columns.map(({ name, slug, position, isFinal }) => ({
        name,
        slug,
        position,
        isFinal,
      })),
    ).toEqual([
      { name: "Backlog", slug: "backlog", position: 0, isFinal: false },
      { name: "Doing", slug: "doing", position: 1, isFinal: false },
      { name: "Shipped", slug: "shipped", position: 2, isFinal: true },
      {
        name: "Planned list",
        slug: "planned-list",
        position: 3,
        isFinal: false,
      },
    ]);
    const columnId = (slug: string) =>
      columns.find((column) => column.slug === slug)?.id;

    const tasks = await app.db.find(TaskEntity, {
      where: { projectId },
      order: { number: "ASC" },
    });
    expect(
      tasks.map((task) => ({
        number: task.number,
        title: task.title,
        status: task.status,
        columnId: task.columnId,
        position: task.position,
        priority: task.priority,
        userId: task.userId,
      })),
    ).toEqual([
      {
        number: 1,
        title: "Write the copy",
        status: "backlog",
        columnId: columnId("backlog"),
        position: 1,
        priority: "high",
        userId: member.id,
      },
      {
        number: 2,
        title: "Untitled task",
        status: "backlog",
        columnId: columnId("backlog"),
        position: 2,
        priority: "no-priority",
        userId: null,
      },
      {
        number: 3,
        title: "Someday",
        status: "planned",
        columnId: null,
        position: 1,
        priority: "low",
        userId: null,
      },
      {
        number: 4,
        title: "Old launch",
        status: "archived",
        columnId: null,
        position: 1,
        priority: "no-priority",
        userId: null,
      },
      {
        number: 5,
        title: "Ship it",
        status: "shipped",
        columnId: columnId("shipped"),
        position: 1,
        priority: "urgent",
        userId: null,
      },
    ]);
    const [first, , someday, , shipIt] = tasks;
    expect(first?.description).toBe("Draft **all** pages");
    expect(first?.createdAt.toISOString()).toBe("2023-05-06T07:08:09.000Z");
    expect(first?.dueDate?.toISOString()).toBe("2024-02-01T00:00:00.000Z");

    const definitions = await app.db.find(LabelEntity, {
      select: { name: true, color: true },
      where: { workspaceId, taskId: IsNull() },
      order: { name: "ASC" },
    });
    expect(definitions.map(({ name, color }) => ({ name, color }))).toEqual([
      { name: "Bug", color: "#123456" },
      { name: "Design", color: "purple" },
    ]);
    const taskIds = tasks.map((task) => task.id);
    const taskLabels = (
      await app.db.find(LabelEntity, {
        where: { taskId: In(taskIds) },
        order: { name: "ASC" },
      })
    ).map(({ taskId, name, color }) => ({ taskId, name, color }));
    expect(taskLabels).toEqual(
      expect.arrayContaining([
        { taskId: first?.id, name: "Bug", color: "#123456" },
        { taskId: first?.id, name: "Design", color: "purple" },
        { taskId: shipIt?.id, name: "Bug", color: "#123456" },
      ]),
    );
    expect(taskLabels).toHaveLength(3);

    const activities = await app.db.find(ActivityEntity, {
      where: { taskId: In(taskIds) },
    });
    const created = activities.filter(
      (activity) => activity.type === "created",
    );
    expect(created).toHaveLength(5);
    expect(created.every((activity) => activity.userId === admin.user.id)).toBe(
      true,
    );
    expect(
      created.find((activity) => activity.taskId === first?.id)?.createdAt,
    ).toEqual(first?.createdAt);
    const comments = activities
      .filter((activity) => activity.type === "comment")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(
      comments.map((comment) => ({
        taskId: comment.taskId,
        userId: comment.userId,
        content: comment.content,
        externalUserName: comment.externalUserName,
        externalSource: comment.externalSource,
      })),
    ).toEqual([
      {
        taskId: first?.id,
        userId: admin.user.id,
        content: "Looks good",
        externalUserName: "Ana",
        externalSource: "planka",
      },
      {
        taskId: first?.id,
        userId: admin.user.id,
        content: "No author",
        externalUserName: "Unknown user",
        externalSource: "planka",
      },
    ]);
    expect(comments[0]?.createdAt.toISOString()).toBe(
      "2024-01-02T03:04:05.000Z",
    );

    const relations = (
      await app.db.find(TaskRelationEntity, {
        where: { sourceTaskId: In(taskIds) },
      })
    ).map(({ sourceTaskId, targetTaskId, relationType }) => ({
      sourceTaskId,
      targetTaskId,
      relationType,
    }));
    expect(relations).toEqual(
      expect.arrayContaining([
        {
          sourceTaskId: first?.id,
          targetTaskId: shipIt?.id,
          relationType: "subtask",
        },
        {
          sourceTaskId: first?.id,
          targetTaskId: someday?.id,
          relationType: "blocks",
        },
      ]),
    );
    expect(relations).toHaveLength(2);

    expect(await app.db.find(NotificationEntity)).toEqual([]);

    const storedRun = await app.db.findOne(ImportRunEntity, {
      where: { id: run.id },
    });
    expect(storedRun?.userId).toBe(admin.user.id);
    expect(JSON.stringify(storedRun)).not.toContain(SECRET);

    const listed = await get(`/runs/${workspaceId}`);
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(listedText).not.toContain(SECRET);
    expect(JSON.parse(listedText).runs).toHaveLength(1);
  });

  it("leaves no project behind when saving its content fails", async () => {
    const admin = await createAdmin();
    const workspaceId = admin.workspace.id;
    importers.connectSource.mockResolvedValue(
      fakeSource(async () => plankaProject("")),
    );
    vi.mocked(writeImportRelations).mockRejectedValueOnce(
      new Error("relations failed"),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    app.auth.signIn(admin.user);

    try {
      const started = await post("/runs", {
        workspaceId,
        connection,
        projectIds: ["p1"],
      });
      expect(started.status).toBe(202);
      const { run } = (await started.json()) as { run: { id: string } };
      await waitForActiveImports();

      const polled = await get(`/runs/${workspaceId}/${run.id}`);
      const { run: finished } = (await polled.json()) as {
        run: { projects: Record<string, unknown>[] };
      };
      expect(finished.projects).toEqual([
        expect.objectContaining({
          status: "failed",
          projectId: null,
          error: "Kaneo could not save this project.",
        }),
      ]);
      expect(writeImportRelations).toHaveBeenCalled();

      expect(await app.db.find(ProjectEntity, { where: { workspaceId } })).toEqual(
        [],
      );
    } finally {
      logged.mockRestore();
    }
  });

  it("keeps the source key and task numbers", async () => {
    const admin = await createAdmin();
    const workspaceId = admin.workspace.id;
    importers.connectSource.mockResolvedValue(
      fakeSource(async () => numberedProject()),
    );
    app.auth.signIn(admin.user);

    const imported = await importProject(workspaceId);
    expect(imported.projectSlug).toBe("ENG");

    const project = await app.db.findOne(ProjectEntity, {
      where: { id: imported.projectId },
    });
    expect(project).toMatchObject({ slug: "ENG", lastTaskNumber: 9 });

    const tasks = await app.db.find(TaskEntity, {
      where: { projectId: imported.projectId },
      order: { number: "ASC" },
    });
    expect(
      tasks.map(({ number, title, status, position }) => ({
        number,
        title,
        status,
        position,
      })),
    ).toEqual([
      { number: 3, title: "Three", status: "to-do", position: 3 },
      { number: 7, title: "Seven", status: "to-do", position: 1 },
      { number: 8, title: "No number", status: "to-do", position: 2 },
      { number: 9, title: "Another seven", status: "to-do", position: 4 },
    ]);

    const created = await app.request(`/api/task/${imported.projectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Made after the import",
        description: "",
        priority: "low",
        status: "to-do",
      }),
    });
    expect(created.status).toBe(200);
    expect(((await created.json()) as { number: number }).number).toBe(10);
  });

  it("keeps assignments to an importer limited to selected projects", async () => {
    const admin = await createAdmin();
    const workspaceId = admin.workspace.id;
    await insertRow(app.db, WorkspaceMemberAccessEntity, {
      workspaceId,
      userId: admin.user.id,
      projectAccess: "selected",
    });
    const project = numberedProject();
    const [first] = project.tasks;
    if (first) first.assignee = { email: admin.user.email };
    importers.connectSource.mockResolvedValue(fakeSource(async () => project));
    app.auth.signIn(admin.user);

    const imported = await importProject(workspaceId);

    const grants = await app.db.find(WorkspaceMemberProjectEntity, {
      where: { userId: admin.user.id, projectId: imported.projectId },
    });
    expect(grants).toHaveLength(1);

    const assigned = await app.db.findOne(TaskEntity, {
      where: { projectId: imported.projectId, number: 7 },
    });
    expect(assigned?.userId).toBe(admin.user.id);
  });

  it("suffixes the source key when the workspace already uses it", async () => {
    const admin = await createAdmin();
    const workspaceId = admin.workspace.id;
    await createProjectFixture(app.db, {
      workspaceId,
      name: "Existing",
      slug: "ENG",
    });
    importers.connectSource.mockResolvedValue(
      fakeSource(async () => numberedProject()),
    );
    app.auth.signIn(admin.user);

    const imported = await importProject(workspaceId);

    expect(imported.projectSlug).toBe("ENG-2");
    const project = await app.db.findOne(ProjectEntity, {
      where: { id: imported.projectId },
    });
    expect(project?.slug).toBe("ENG-2");
  });

  it("refuses members and viewers", async () => {
    const admin = await createAdmin();
    const workspaceId = admin.workspace.id;
    const member = await addMember(workspaceId, "Member");
    const viewer = await addMember(workspaceId, "Viewer", "viewer");

    for (const user of [member, viewer]) {
      app.auth.signIn(user);
      const listed = await post("/projects", { workspaceId, connection });
      expect(listed.status).toBe(403);
      const started = await post("/runs", {
        workspaceId,
        connection,
        projectIds: ["p1"],
      });
      expect(started.status).toBe(403);
      expect((await get(`/runs/${workspaceId}`)).status).toBe(403);
      expect((await get(`/runs/${workspaceId}/run-1`)).status).toBe(403);
      expect((await get(`/trello/authorize-url/${workspaceId}`)).status).toBe(
        403,
      );
    }

    expect(importers.connectSource).not.toHaveBeenCalled();
  });

  it("links admins to Trello's authorize page only when the server has a key", async () => {
    const admin = await createAdmin();
    const workspaceId = admin.workspace.id;
    app.auth.signIn(admin.user);

    try {
      vi.stubEnv("TRELLO_API_KEY", "");
      const unset = await get(`/trello/authorize-url/${workspaceId}`);
      expect(unset.status).toBe(200);
      expect(await unset.json()).toEqual({ authorizeUrl: null });

      vi.stubEnv("TRELLO_API_KEY", " trello-app-key ");
      const set = await get(`/trello/authorize-url/${workspaceId}`);
      expect(set.status).toBe(200);
      const body = (await set.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(["authorizeUrl"]);
      const url = new URL(String(body.authorizeUrl));
      expect(url.origin + url.pathname).toBe("https://trello.com/1/authorize");
      expect(url.searchParams.get("key")).toBe("trello-app-key");
      expect(url.searchParams.get("scope")).toBe("read");

      const config = await app.request("/api/config");
      expect(await config.text()).not.toContain("trello-app-key");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("allows one running import per workspace", async () => {
    const admin = await createAdmin();
    const workspaceId = admin.workspace.id;
    await insertRow(app.db, ImportRunEntity, {
      workspaceId,
      userId: admin.user.id,
      source: "linear",
      projects: [],
    });
    importers.connectSource.mockResolvedValue(
      fakeSource(async () => plankaProject("")),
    );
    app.auth.signIn(admin.user);

    const response = await post("/runs", {
      workspaceId,
      connection,
      projectIds: ["p1"],
    });

    expect(response.status).toBe(409);
    expect(importers.connectSource).not.toHaveBeenCalled();
  });

  it("reports and settles a run whose server stopped answering", async () => {
    const admin = await createAdmin();
    const workspaceId = admin.workspace.id;
    const stale = await insertRow(app.db, ImportRunEntity, {
      workspaceId,
      userId: admin.user.id,
      source: "trello",
      projects: [
        {
          sourceId: "b1",
          name: "Board",
          status: "running",
          projectId: null,
          projectSlug: null,
          counts: emptyCounts,
          warnings: [],
          error: null,
        },
      ],
      heartbeatAt: new Date(Date.now() - 5 * 60_000),
    });
    app.auth.signIn(admin.user);

    const response = await get(`/runs/${workspaceId}`);

    expect(response.status).toBe(200);
    const { runs } = (await response.json()) as {
      runs: { status: string; error: string; projects: { status: string }[] }[];
    };
    expect(runs[0]).toMatchObject({
      status: "failed",
      error: "The import was interrupted before it finished.",
      projects: [{ status: "failed" }],
    });
    const stored = await app.db.findOne(ImportRunEntity, {
      where: { id: stale.id },
    });
    expect(stored?.status).toBe("failed");
    expect(stored?.finishedAt).not.toBeNull();
    expect(stored?.projects).toEqual([
      expect.objectContaining({
        status: "failed",
        error: "The import was interrupted before it finished.",
      }),
    ]);
  });

  it("limits how many imports one server runs at once", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    importers.connectSource.mockImplementation(async () =>
      fakeSource(async () => {
        await gate;
        return { ...plankaProject(""), tasks: [], relations: [] };
      }),
    );

    try {
      for (let index = 0; index < 2; index++) {
        const admin = await createAdmin();
        app.auth.signIn(admin.user);
        const response = await post("/runs", {
          workspaceId: admin.workspace.id,
          connection,
          projectIds: ["p1"],
        });
        expect(response.status).toBe(202);
      }

      const third = await createAdmin();
      app.auth.signIn(third.user);
      const response = await post("/runs", {
        workspaceId: third.workspace.id,
        connection,
        projectIds: ["p1"],
      });
      expect(response.status).toBe(429);
    } finally {
      release();
      await waitForActiveImports();
    }
  });

  it("rejects projects the source does not list and runs from other workspaces", async () => {
    const admin = await createAdmin();
    const other = await createAdmin();
    const foreign = await insertRow(app.db, ImportRunEntity, {
      workspaceId: other.workspace.id,
      source: "planka",
      projects: [],
      status: "completed",
    });
    importers.connectSource.mockResolvedValue(
      fakeSource(async () => plankaProject("")),
    );
    app.auth.signIn(admin.user);

    const missing = await post("/runs", {
      workspaceId: admin.workspace.id,
      connection,
      projectIds: ["p9"],
    });
    expect(missing.status).toBe(400);
    expect((await readErrorBody(missing)).message).toBe(
      "A selected project is no longer available in PLANKA. Refresh the list and try again.",
    );

    const duplicate = await post("/runs", {
      workspaceId: admin.workspace.id,
      connection,
      projectIds: ["p1", "p1"],
    });
    expect(duplicate.status).toBe(400);

    const notHere = await get(`/runs/${admin.workspace.id}/${foreign.id}`);
    expect(notHere.status).toBe(404);
  });
});
