import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ApikeyEntity } from "../../src/database/entities/apikey.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { EventBus } from "../../src/events/event-bus";
import { eventContext } from "../../src/events/event-context";
import { RealtimeConnections } from "../../src/realtime/realtime-connections";
import { type Browser, signUpBrowser } from "../support/browser";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspace } from "../support/fixtures/create-workspace";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { restrictToProjects } from "../support/fixtures/restrict-to-projects";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import {
  closeSockets,
  connectSocket,
  type TestSocket,
} from "../support/realtime-client";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const ORIGIN = "http://localhost:5173";

describe("API integration: WebSockets", () => {
  let app: TestApp;
  let admin: Browser;
  let member: Browser;
  let workspaceId: string;
  let projectId: string;

  const cookieOf = (browser: Browser) => browser.jar.header("/api/ws");
  const browserHeaders = (browser: Browser) => ({
    cookie: cookieOf(browser),
    origin: ORIGIN,
  });
  const connect = (path: string, headers: Record<string, string>) =>
    connectSocket(app, `/api/ws/${path}`, headers);

  async function quiet(socket: TestSocket, ms = 250) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return socket.messages;
  }

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("KANEO_CLIENT_URL", "");
    vi.stubEnv("KANEO_API_URL", "");
    vi.stubEnv("CORS_ORIGINS", "https://extra.example.test");
    // The first account of an instance becomes its administrator.
    admin = await signUpBrowser(app, "admin@example.test", "Admin");
    member = await signUpBrowser(app, "member@example.test", "Member");
    const workspace = await createWorkspace(app.db);
    workspaceId = workspace.id;
    await addWorkspaceMember(app.db, workspaceId, member.userId, "owner");
    projectId = (await createProjectFixture(app.db, { workspaceId })).project.id;
  });

  afterEach(() => {
    closeSockets();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await app.close();
  });

  describe.each(["project", "user"])("%s WebSocket", (endpoint) => {
    const path = () => (endpoint === "user" ? "user" : projectId);

    it("consumes a single quota and rate-limit unit per API-key handshake", async () => {
      const { key, row } = await seedApiKey(app.db, member.userId, {
        remaining: 1,
        rateLimitEnabled: true,
        rateLimitMax: 1,
        rateLimitTimeWindow: 60_000,
      });

      expect((await connect(path(), { "x-api-key": key })).status).toBe(101);
      const saved = await app.db.findOneByOrFail(ApikeyEntity, { id: row.id });
      expect(saved.remaining).toBe(0);
      expect(saved.requestCount).toBe(1);
      expect((await connect(path(), { "x-api-key": key })).status).toBe(429);
    });

    it("rejects missing, null, hostile and lookalike browser origins", async () => {
      for (const origin of [
        undefined,
        "null",
        "https://evil.example.test",
        "http://localhost:5173.evil.test",
        "http://localhost:5173/",
        "http://localhost:5174",
      ]) {
        const { status } = await connect(path(), {
          cookie: cookieOf(member),
          ...(origin === undefined ? {} : { origin }),
        });
        expect(status, String(origin)).toBe(403);
      }
    });

    it("allows configured origins and explicit native sessions, retaining authentication", async () => {
      for (const origin of [
        "http://localhost:5173",
        "http://localhost:1337",
        "https://extra.example.test",
      ]) {
        expect(
          (await connect(path(), { cookie: cookieOf(member), origin })).status,
        ).toBe(101);
      }
      const token = member.jar.get("kaneo.access_token");
      expect(
        (await connect(path(), { authorization: `Bearer ${token}` })).status,
      ).toBe(101);
      expect(
        (
          await connect(path(), {
            authorization: "Bearer invalid",
            cookie: cookieOf(member),
          })
        ).status,
      ).toBe(401);
      expect((await connect(path(), { origin: ORIGIN })).status).toBe(401);
    });

    it.each(["text", "binary", "fragmented"])(
      "rejects oversized %s messages before application delivery",
      async (kind) => {
        const { socket, status, closed } = await connect(
          path(),
          browserHeaders(member),
        );
        expect(status).toBe(101);
        if (kind === "fragmented") {
          socket.send("a".repeat(40), { fin: false });
          socket.send("b".repeat(40), { fin: true });
        } else {
          socket.send(kind === "binary" ? Buffer.alloc(65) : "a".repeat(65));
        }
        expect((await closed).code).toBe(1009);
      },
    );

    it.each([
      ["unsupported JSON", '{"type":"other"}', 1008],
      ["malformed JSON", "{", 1008],
      ["binary ping", Buffer.from('{"type":"ping"}'), 1003],
    ] as const)(
      "closes %s and keeps valid pings working",
      async (_name, payload, code) => {
        const { socket, status, closed } = await connect(
          path(),
          browserHeaders(member),
        );
        expect(status).toBe(101);
        socket.send('{"type":"ping"}');
        const pong = new Promise((resolve) => socket.once("pong", resolve));
        socket.ping("test");
        await pong;
        expect(socket.readyState).toBe(1);
        socket.send(payload);
        expect((await closed).code).toBe(code);
      },
    );
  });

  it("refuses unknown paths and non-GET upgrades", async () => {
    expect((await connect("user/extra", browserHeaders(member))).status).toBe(
      404,
    );
    expect(
      (await connectSocket(app, "/api/other", browserHeaders(member))).status,
    ).toBe(404);
  });

  it("synchronizes workspace access when the user socket opens", async () => {
    const socket = await connect("user", browserHeaders(member));
    expect(socket.status).toBe(101);
    expect(await socket.next("WORKSPACE_ACCESS_SYNC")).toEqual({
      type: "WORKSPACE_ACCESS_SYNC",
      workspaceIds: [workspaceId],
    });
  });

  it("preserves user event delivery after keepalive", async () => {
    const socket = await connect("user", browserHeaders(member));
    expect(socket.status).toBe(101);
    socket.socket.send('{"type":"ping"}');
    await app
      .get(EventBus)
      .publish("notification.created", { userId: member.userId });
    expect(await socket.next("NOTIFICATION_CREATED")).toMatchObject({
      type: "NOTIFICATION_CREATED",
    });
  });

  it("still rejects a foreign, missing or hidden project with a valid Origin", async () => {
    const foreign = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: foreign.workspace.id,
    });
    expect((await connect(project.id, browserHeaders(member))).status).toBe(
      404,
    );
    expect(
      (await connect("missing-project", browserHeaders(member))).status,
    ).toBe(404);

    const other = await createProjectFixture(app.db, { workspaceId });
    await app.db.update(
      WorkspaceUserEntity,
      { workspaceId, userId: member.userId },
      { role: "member" },
    );
    await restrictToProjects(app.db, workspaceId, member.userId, [
      other.project.id,
    ]);
    expect((await connect(projectId, browserHeaders(member))).status).toBe(
      403,
    );
  });

  it("lets an instance admin open any existing project", async () => {
    expect((await connect(projectId, browserHeaders(admin))).status).toBe(101);
  });

  it("delivers a published event to other windows but not to the initiating one", async () => {
    const initiating = await connect(
      `${projectId}?windowId=one`,
      browserHeaders(member),
    );
    const other = await connect(
      `${projectId}?windowId=two`,
      browserHeaders(member),
    );
    expect([initiating.status, other.status]).toEqual([101, 101]);

    await eventContext.run(
      { initiatorId: `${member.userId}:one` },
      () =>
        app.get(EventBus).publish("task.updated", {
          projectId,
          taskId: "task-1",
          userId: member.userId,
        }),
    );

    expect(await other.next("TASK_UPDATED")).toEqual({
      type: "TASK_UPDATED",
      projectId,
      taskId: "task-1",
    });
    expect(await quiet(initiating)).toEqual([]);
  });

  it("closes the sockets of a session when it signs out", async () => {
    const userSocket = await connect("user", browserHeaders(member));
    const board = await connect(projectId, browserHeaders(member));
    const adminSocket = await connect("user", browserHeaders(admin));
    expect([userSocket.status, board.status, adminSocket.status]).toEqual([
      101, 101, 101,
    ]);

    expect((await member.post("/api/auth/sign-out")).status).toBe(200);

    expect(await userSocket.closed).toEqual({
      code: 1008,
      reason: "Session revoked",
    });
    expect(await board.closed).toEqual({
      code: 1008,
      reason: "Session revoked",
    });
    expect(adminSocket.socket.readyState).toBe(1);
  });

  it("revokes a removed member's board and tells their user socket", async () => {
    const userSocket = await connect("user", browserHeaders(member));
    const board = await connect(projectId, browserHeaders(member));
    await userSocket.next("WORKSPACE_ACCESS_SYNC");

    await app.db.delete(WorkspaceUserEntity, {
      workspaceId,
      userId: member.userId,
    });
    await app
      .get(RealtimeConnections)
      .revokeWorkspaceConnections(member.userId, workspaceId);

    expect(await board.closed).toEqual({
      code: 1008,
      reason: "Workspace access revoked",
    });
    expect(await userSocket.next("WORKSPACE_ACCESS_REVOKED")).toEqual({
      type: "WORKSPACE_ACCESS_REVOKED",
      workspaceId,
    });
  });

  it("stops broadcasts to a member removed without a revocation", async () => {
    const board = await connect(projectId, browserHeaders(member));
    await app.db.delete(WorkspaceUserEntity, {
      workspaceId,
      userId: member.userId,
    });

    await app
      .get(EventBus)
      .publish("task.created", { projectId, taskId: "private-task" });

    expect(await board.closed).toEqual({
      code: 1008,
      reason: "Workspace access revoked",
    });
    expect(board.messages).toEqual([]);
  });

  it("closes a board that is no longer visible after a project access change", async () => {
    const other = await createProjectFixture(app.db, { workspaceId });
    await app.db.update(
      WorkspaceUserEntity,
      { workspaceId, userId: member.userId },
      { role: "member" },
    );
    const userSocket = await connect("user", browserHeaders(member));
    const board = await connect(projectId, browserHeaders(member));
    await restrictToProjects(app.db, workspaceId, member.userId, [
      other.project.id,
    ]);

    await app.get(EventBus).publish("project_access.updated", {
      workspaceId,
      userId: member.userId,
    });

    expect(await board.closed).toEqual({
      code: 1008,
      reason: "Project access revoked",
    });
    expect(await userSocket.next("PROJECT_ACCESS_CHANGED")).toEqual({
      type: "PROJECT_ACCESS_CHANGED",
      workspaceId,
    });
  });

  it("revokes every socket of a deleted user", async () => {
    const userSocket = await connect("user", browserHeaders(member));
    const board = await connect(projectId, browserHeaders(member));
    await userSocket.next("WORKSPACE_ACCESS_SYNC");

    await app.get(RealtimeConnections).revokeUserConnections(member.userId);

    expect(await userSocket.next("USER_ACCESS_REVOKED")).toEqual({
      type: "USER_ACCESS_REVOKED",
    });
    expect((await userSocket.closed).code).toBe(1008);
    expect(await board.closed).toEqual({
      code: 1008,
      reason: "User access revoked",
    });
  });

  it("closes boards of a moved project after telling them", async () => {
    const board = await connect(projectId, browserHeaders(member));

    await app.get(RealtimeConnections).closeProjectConnections(projectId);

    expect(await board.closed).toEqual({
      code: 1008,
      reason: "Project workspace changed",
    });
    expect(board.messages).toEqual([{ type: "PROJECT_MOVED", projectId }]);
  });

  it("evicts a deleted workspace for an implicit administrator and reconciles reconnects", async () => {
    const own = await createWorkspace(app.db);
    await addWorkspaceMember(app.db, own.id, admin.userId, "owner");
    expect(
      (
        await app.db.findOneByOrFail(UserEntity, { id: admin.userId })
      ).role?.split(","),
    ).toContain("admin");
    const global = await connect("user", browserHeaders(admin));
    const board = await connect(projectId, browserHeaders(admin));
    await global.next("WORKSPACE_ACCESS_SYNC");

    const deleted = await member.post("/api/auth/organization/delete", {
      organizationId: workspaceId,
    });
    expect(deleted.status).toBe(200);

    expect(await board.closed).toEqual({
      code: 1008,
      reason: "Workspace access revoked",
    });
    expect(await global.next("WORKSPACE_ACCESS_REVOKED")).toEqual({
      type: "WORKSPACE_ACCESS_REVOKED",
      workspaceId,
    });

    const reconnected = await connect("user", browserHeaders(admin));
    const snapshot = await reconnected.next("WORKSPACE_ACCESS_SYNC");
    expect(snapshot.workspaceIds).toContain(own.id);
    expect(snapshot.workspaceIds).not.toContain(workspaceId);
  });
});
