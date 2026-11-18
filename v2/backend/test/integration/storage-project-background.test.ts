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
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { StorageCleanupEntity } from "../../src/database/entities/storage-cleanup.entity";
import { EventBus } from "../../src/events/event-bus";
import { ObjectStore } from "../../src/storage/object-store/object-store";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import {
  JPEG_BYTES,
  PNG_BYTES,
  postForm,
  uploadForm,
} from "../support/fixtures/storage-files";
import { InMemoryObjectStore } from "../support/in-memory-object-store";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api-integration/project-background.test.ts. The
// presign + finalize pair is one multipart upload now; the WebSocket check
// is an event-bus check here (the realtime module turns `project.updated`
// into PROJECT_UPDATED).
describe("API integration: project backgrounds", () => {
  const store = new InMemoryObjectStore();
  const projectUpdates: unknown[] = [];
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[ObjectStore, store]] });
    app.get(EventBus).subscribe("project.updated", async (data) => {
      projectUpdates.push(data);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    store.reset();
    projectUpdates.length = 0;
    vi.stubEnv("S3_KEY_PREFIX", "");
    vi.stubEnv("KANEO_API_URL", "http://kaneo.test:1337");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function seedProject(role = "owner") {
    const member = await createWorkspaceMember(app.db, { role });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);
    return { ...member, project };
  }

  function uploadBackground(
    projectId: string,
    file = { bytes: PNG_BYTES, type: "image/png", name: "bg.png" },
  ) {
    return app.request(
      `/api/project/${projectId}/background-upload`,
      postForm(uploadForm(file)),
    );
  }

  it("uploads, serves, replaces and removes a background, announcing each change", async () => {
    const { project, workspace } = await seedProject();

    const uploaded = await uploadBackground(project.id);
    expect(uploaded.status).toBe(200);
    const first = await app.db.findOneByOrFail(ProjectEntity, {
      id: project.id,
    });
    expect(first.backgroundMimeType).toBe("image/png");
    expect(first.backgroundObjectKey).toBe(
      `workspace/${workspace.id}/project/${project.id}/backgrounds/background-${first.backgroundVersion}`,
    );
    expect(await uploaded.json()).toEqual({
      url: `http://kaneo.test:1337/api/project/${project.id}/background?v=${first.backgroundVersion}`,
    });
    await vi.waitFor(() =>
      expect(projectUpdates).toEqual([
        expect.objectContaining({ projectId: project.id }),
      ]),
    );

    const download = await app.request(`/api/project/${project.id}/background`);
    expect(download.status).toBe(200);
    expect(Object.fromEntries(download.headers)).toMatchObject({
      "cache-control": "private, max-age=300, must-revalidate",
      "content-type": "image/png",
      vary: "Cookie, Authorization",
      "x-content-type-options": "nosniff",
    });
    expect(Buffer.from(await download.arrayBuffer())).toEqual(PNG_BYTES);
    const etag = download.headers.get("etag") ?? "";
    const notModified = await app.request(
      `/api/project/${project.id}/background`,
      { headers: { "If-None-Match": etag } },
    );
    expect(notModified.status).toBe(304);

    const replaced = await uploadBackground(project.id, {
      bytes: JPEG_BYTES,
      type: "image/jpeg",
      name: "bg.jpg",
    });
    expect(replaced.status).toBe(200);
    const second = await app.db.findOneByOrFail(ProjectEntity, {
      id: project.id,
    });
    expect(second.backgroundVersion).not.toBe(first.backgroundVersion);
    expect(second.backgroundMimeType).toBe("image/jpeg");
    expect([...store.objects.keys()]).toEqual([second.backgroundObjectKey]);
    expect(await app.db.find(StorageCleanupEntity)).toEqual([]);

    projectUpdates.length = 0;
    const removed = await app.request(`/api/project/${project.id}/background`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    await vi.waitFor(() =>
      expect(projectUpdates).toEqual([
        expect.objectContaining({ projectId: project.id }),
      ]),
    );
    expect(
      await app.db.findOneByOrFail(ProjectEntity, { id: project.id }),
    ).toMatchObject({
      backgroundVersion: null,
      backgroundObjectKey: null,
      backgroundMimeType: null,
    });
    expect(store.objects.size).toBe(0);
    expect(await app.db.find(StorageCleanupEntity)).toEqual([]);

    const gone = await app.request(`/api/project/${project.id}/background`);
    expect(gone.status).toBe(404);
    expect(await readErrorBody(gone)).toMatchObject({
      message: "Project background not found",
    });
  });

  it("keeps the replaced object queued when the bucket refuses its deletion", async () => {
    const { project } = await seedProject();
    expect((await uploadBackground(project.id)).status).toBe(200);
    const { backgroundObjectKey } = await app.db.findOneByOrFail(
      ProjectEntity,
      { id: project.id },
    );
    vi.spyOn(store, "delete").mockRejectedValueOnce(new Error("offline"));

    const removed = await app.request(`/api/project/${project.id}/background`, {
      method: "DELETE",
    });

    expect(removed.status).toBe(204);
    const queued = await app.db.find(StorageCleanupEntity);
    expect(queued.map((row) => row.objectKey)).toEqual([backgroundObjectKey]);
    expect(queued[0]?.lastAttemptAt).toBeInstanceOf(Date);
  });

  it("only accepts supported images", async () => {
    const { project } = await seedProject();

    const pdf = await uploadBackground(project.id, {
      bytes: Buffer.from("%PDF-1.4"),
      type: "application/pdf",
      name: "bg.pdf",
    });
    expect(pdf.status).toBe(400);
    expect(await readErrorBody(pdf)).toMatchObject({
      message: 'Unsupported content type "application/pdf". Upload a supported image.',
    });

    const disguised = await uploadBackground(project.id, {
      bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      type: "image/png",
      name: "bg.png",
    });
    expect(disguised.status).toBe(400);

    const empty = await uploadBackground(project.id, {
      bytes: Buffer.alloc(0),
      type: "image/png",
      name: "bg.png",
    });
    expect(empty.status).toBe(400);
    expect(await readErrorBody(empty)).toMatchObject({
      message: "Upload size must be greater than zero.",
    });

    expect(store.objects.size).toBe(0);
    expect(projectUpdates).toEqual([]);
  });

  it("rejects background mutations without project update permission", async () => {
    const { project } = await seedProject("viewer");
    const put = vi.spyOn(store, "put");

    expect((await uploadBackground(project.id)).status).toBe(403);
    expect(
      (
        await app.request(`/api/project/${project.id}/background`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    expect(put).not.toHaveBeenCalled();
  });

  it("lets readers download but answers 404 without a background", async () => {
    const { project } = await seedProject("viewer");

    const response = await app.request(`/api/project/${project.id}/background`);

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Project background not found",
    });
  });

  it.skip("does not leak storage fields through the project and task routes (needs the project and task modules' GET routes)", () => {});
});
