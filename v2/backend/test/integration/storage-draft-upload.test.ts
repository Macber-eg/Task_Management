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
import { AssetEntity } from "../../src/database/entities/asset.entity";
import { ObjectStore } from "../../src/storage/object-store/object-store";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { PNG_BYTES, postForm, uploadForm } from "../support/fixtures/storage-files";
import { InMemoryObjectStore } from "../support/in-memory-object-store";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api-integration/staged-upload-permissions.test.ts and
// the upload half of staged-task-attachments.test.ts. Staging and
// finalizing are one multipart request now, so an upload is recorded as a
// claimable `draft` straight away. Claiming drafts on task creation belongs
// to the task module.
describe("API integration: staged task attachments", () => {
  const store = new InMemoryObjectStore();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[ObjectStore, store]] });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    store.reset();
    vi.stubEnv("S3_KEY_PREFIX", "");
    vi.stubEnv("KANEO_API_URL", "http://kaneo.test:1337");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function stage(projectId: string, init?: RequestInit) {
    return app.request(
      `/api/task/draft-upload/${projectId}`,
      init ??
        postForm(
          uploadForm({ bytes: PNG_BYTES, type: "image/png", name: "image.png" }),
        ),
    );
  }

  it("stores a private draft attachment without creating a task", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    app.auth.signIn(user);

    const response = await stage(project.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; url: string };
    expect(payload.url).toBe(`http://kaneo.test:1337/api/asset/${payload.id}`);
    const asset = await app.db.findOneByOrFail(AssetEntity, { id: payload.id });
    expect(asset).toMatchObject({
      workspaceId: workspace.id,
      projectId: project.id,
      taskId: null,
      surface: "draft",
      kind: "image",
      filename: "image.png",
      mimeType: "image/png",
      size: PNG_BYTES.length,
      createdBy: user.id,
    });
    expect(asset.objectKey).toMatch(
      new RegExp(
        `^workspace/${workspace.id}/project/${project.id}/task/draft-${user.id}/descriptions/image-`,
      ),
    );
    expect(store.objects.has(asset.objectKey)).toBe(true);
    expect(await app.db.query("SELECT 1 FROM task")).toEqual([]);

    const download = await app.request(`/api/asset/${payload.id}`);
    expect(download.status).toBe(200);
  });

  it("rejects staged uploads without task creation permission before reading the file", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "draft-reader",
    });
    await addWorkspaceRole(app.db, workspace.id, "draft-reader", {
      task: ["read"],
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    app.auth.signIn(user);
    const put = vi.spyOn(store, "put");

    const response = await stage(project.id);

    expect(response.status).toBe(403);
    expect(put).not.toHaveBeenCalled();
    expect(await app.db.find(AssetEntity)).toEqual([]);
  });

  it("refuses the previous JSON presign request with 415", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    app.auth.signIn(user);

    const response = await stage(project.id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "private.png",
        contentType: "image/png",
        size: 12,
        surface: "description",
      }),
    });

    expect(response.status).toBe(415);
    expect(store.objects.size).toBe(0);
  });

  it("answers 404 for an unknown project", async () => {
    const { user } = await createWorkspaceMember(app.db);
    app.auth.signIn(user);

    const response = await stage("missing-project");

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Project not found",
    });
  });

  it("rejects an empty file", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    app.auth.signIn(user);

    const response = await stage(
      project.id,
      postForm(
        uploadForm({ bytes: new Uint8Array(), type: "image/png", name: "x.png" }),
      ),
    );

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Upload size must be a positive safe integer.",
    });
  });
});
