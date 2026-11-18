import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
import { TaskEntity } from "../../src/database/entities/task.entity";
import { ActiveImports } from "../../src/import/active-imports";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const API_KEY = "planka-remote-key-0123456789";

const projects = {
  items: [{ id: "p1", name: "Marketing" }],
  included: {
    boards: [{ id: "b1", projectId: "p1", name: "Content", position: 1 }],
  },
};

const board = {
  item: { id: "b1", projectId: "p1", name: "Content", position: 1 },
  included: {
    lists: [
      {
        id: "l_todo",
        boardId: "b1",
        name: "To Do",
        type: "active",
        position: 1,
        color: null,
      },
    ],
    cards: [
      {
        id: "c1",
        boardId: "b1",
        listId: "l_todo",
        name: "Write the copy",
        description: null,
        position: 1,
        dueDate: null,
        isDueCompleted: null,
        isClosed: false,
        commentsTotal: 0,
      },
    ],
  },
};

/** A PLANKA instance answering the two reads an import needs. */
function startFakePlanka(): Promise<{ server: Server; url: string; requests: IncomingMessage[] }> {
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.headers["x-api-key"] !== API_KEY) {
      return json(401, { code: "E_UNAUTHORIZED" });
    }
    if (request.url === "/api/projects") return json(200, projects);
    if (request.url === "/api/boards/b1") return json(200, board);
    json(404, { code: "E_NOT_FOUND" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, requests });
    });
  });
}

describe("API integration: import from a remote source", () => {
  let app: TestApp;
  let planka: Awaited<ReturnType<typeof startFakePlanka>>;

  beforeAll(async () => {
    app = await createTestApp();
    planka = await startFakePlanka();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => planka.server.close(resolve));
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    planka.requests.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function post(path: string, body: unknown) {
    return app.request(`/api/import${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses a private source address unless the instance allows it", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    const admin = await createWorkspaceMember(app.db, { role: "admin" });
    app.auth.signIn(admin.user);

    const response = await post("/projects", {
      workspaceId: admin.workspace.id,
      connection: { source: "planka", url: planka.url, apiKey: API_KEY },
    });

    expect(response.status).toBe(400);
    expect((await readErrorBody(response)).message).toBe(
      "PLANKA destination resolves to a non-routable address",
    );
    expect(planka.requests).toHaveLength(0);
  });

  it("explains credentials the source rejects", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    const admin = await createWorkspaceMember(app.db, { role: "admin" });
    app.auth.signIn(admin.user);

    const response = await post("/projects", {
      workspaceId: admin.workspace.id,
      connection: {
        source: "planka",
        url: planka.url,
        apiKey: "wrong-planka-key-0123456789",
      },
    });

    expect(response.status).toBe(400);
    expect((await readErrorBody(response)).message).toBe(
      "Could not sign in to PLANKA. Check the API key.",
    );
  });

  it("lists and imports a board over HTTP", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    const admin = await createWorkspaceMember(app.db, { role: "admin" });
    const workspaceId = admin.workspace.id;
    app.auth.signIn(admin.user);
    const connection = { source: "planka", url: planka.url, apiKey: API_KEY };

    const listed = await post("/projects", { workspaceId, connection });
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(listedText).not.toContain(API_KEY);
    expect(JSON.parse(listedText)).toEqual({
      projects: [{ id: "b1", name: "Marketing", detail: "Marketing" }],
    });

    const started = await post("/runs", {
      workspaceId,
      connection,
      projectIds: ["b1"],
    });
    expect(started.status).toBe(202);
    const { run } = (await started.json()) as { run: { id: string } };
    await app.get(ActiveImports).waitForAll();

    const polled = await app.request(
      `/api/import/runs/${workspaceId}/${run.id}`,
    );
    const { run: finished } = (await polled.json()) as {
      run: {
        status: string;
        projects: { status: string; projectId: string; counts: unknown }[];
      };
    };
    expect(finished.status).toBe("completed");
    const [imported] = finished.projects;
    expect(imported).toMatchObject({
      status: "completed",
      counts: { columns: 1, tasks: 1 },
    });

    const tasks = await app.db.find(TaskEntity, {
      where: { projectId: imported?.projectId },
    });
    expect(tasks.map((task) => [task.title, task.status])).toEqual([
      ["Write the copy", "to-do"],
    ]);
    expect(
      planka.requests.every(
        (request) => request.headers["x-api-key"] === API_KEY,
      ),
    ).toBe(true);
  });
});
