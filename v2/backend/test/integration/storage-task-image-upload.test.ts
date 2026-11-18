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
import { JobLeaseEntity } from "../../src/database/entities/job-lease.entity";
import { StorageCleanupEntity } from "../../src/database/entities/storage-cleanup.entity";
import { ObjectStore } from "../../src/storage/object-store/object-store";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUser } from "../support/fixtures/create-user";
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

// Ported from tests/api-integration/task-image-upload.test.ts and
// asset-finalization.test.ts. The presign + finalize pair became one
// multipart upload, so the finalize-specific cases (key ownership, object
// verification) are replaced by the upload's own validation.
describe("API integration: task image upload", () => {
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

  async function seedTask(role?: string) {
    const member = await createWorkspaceMember(app.db, role ? { role } : {});
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      userId: member.user.id,
      title: "Upload task",
      columnId: columns.todo.id,
      priority: "medium",
      position: 1,
    });
    app.auth.signIn(member.user);
    return { ...member, project, task };
  }

  function upload(
    taskId: string,
    file: { bytes: Uint8Array; type: string; name: string } | null = {
      bytes: PNG_BYTES,
      type: "image/png",
      name: "test-image.png",
    },
    fields: Record<string, string> = { surface: "description" },
  ) {
    return app.request(
      `/api/task/image-upload/${taskId}`,
      postForm(uploadForm(file, fields)),
    );
  }

  it("returns a URL using KANEO_API_URL", async () => {
    const { task } = await seedTask();

    const response = await upload(task.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; url: string };
    expect(payload.url).toBe(`http://kaneo.test:1337/api/asset/${payload.id}`);
  });

  it("updates the URL when KANEO_API_URL changes", async () => {
    vi.stubEnv("KANEO_API_URL", "https://proxy.kaneo.internal");
    const { task } = await seedTask();

    const response = await upload(task.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; url: string };
    expect(payload.url).toBe(
      `https://proxy.kaneo.internal/api/asset/${payload.id}`,
    );
  });

  it("falls back to deriving URL from the request when KANEO_API_URL is not set", async () => {
    vi.stubEnv("KANEO_API_URL", "");
    const { task } = await seedTask();

    const response = await upload(task.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; url: string };
    expect(payload.url).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:\\d+/api/asset/${payload.id}$`),
    );
  });

  it("stores the bytes and persists a new asset record with correct metadata", async () => {
    const { task, project, workspace, user } = await seedTask();

    const response = await upload(task.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string };
    const asset = await app.db.findOneByOrFail(AssetEntity, { id: payload.id });
    expect(asset).toMatchObject({
      filename: "test-image.png",
      mimeType: "image/png",
      size: PNG_BYTES.length,
      kind: "image",
      surface: "description",
      workspaceId: workspace.id,
      projectId: project.id,
      taskId: task.id,
      createdBy: user.id,
    });
    expect(asset.objectKey).toMatch(
      new RegExp(
        `^workspace/${workspace.id}/project/${project.id}/task/${task.id}/descriptions/test-image-\\d+-[a-z0-9]+\\.png$`,
      ),
    );
    expect(store.objects.get(asset.objectKey)).toMatchObject({
      body: PNG_BYTES,
      contentType: "image/png",
    });
    expect(await app.db.find(StorageCleanupEntity)).toEqual([]);
    expect(await app.db.find(JobLeaseEntity)).toEqual([]);
  });

  it("scopes comment images to the comments folder and applies S3_KEY_PREFIX", async () => {
    vi.stubEnv("S3_KEY_PREFIX", "staging/");
    const { task } = await seedTask();

    const response = await upload(task.id, undefined, { surface: "comment" });

    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    const asset = await app.db.findOneByOrFail(AssetEntity, { id });
    expect(asset.surface).toBe("comment");
    expect(asset.objectKey).toMatch(/^staging\/workspace\/.*\/comments\//);
    expect(store.objects.has(asset.objectKey)).toBe(true);
  });

  it("creates attachment records for non-image content types", async () => {
    const { task } = await seedTask();

    const response = await upload(task.id, {
      bytes: Buffer.from("%PDF-1.4 report"),
      type: "application/pdf",
      name: "report.pdf",
    });

    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect(await app.db.findOneByOrFail(AssetEntity, { id })).toMatchObject({
      kind: "attachment",
      mimeType: "application/pdf",
    });
  });

  it("keeps non-ASCII file names", async () => {
    const { task } = await seedTask();

    const response = await upload(task.id, {
      bytes: PNG_BYTES,
      type: "image/png",
      name: "Résumé 日本.png",
    });

    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect(
      (await app.db.findOneByOrFail(AssetEntity, { id })).filename,
    ).toBe("Résumé 日本.png");
  });

  it("stores an image under the type its bytes are", async () => {
    const { task } = await seedTask();

    const response = await upload(task.id, {
      bytes: JPEG_BYTES,
      type: "image/jpg",
      name: "photo.jpg",
    });

    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect(
      (await app.db.findOneByOrFail(AssetEntity, { id })).mimeType,
    ).toBe("image/jpeg");
  });

  it("rejects a file whose bytes are not the image it claims to be", async () => {
    const { task } = await seedTask();

    const response = await upload(task.id, {
      bytes: Buffer.from("<html><script>alert(1)</script></html>"),
      type: "image/png",
      name: "evil.png",
    });

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "The file content does not match its image type.",
      code: "BAD_REQUEST",
    });
    expect(await app.db.find(AssetEntity)).toEqual([]);
    expect(store.objects.size).toBe(0);
  });

  it("rejects empty files with the previous message", async () => {
    const { task } = await seedTask();

    const response = await upload(task.id, {
      bytes: new Uint8Array(),
      type: "image/png",
      name: "empty.png",
    });

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Upload size must be a positive safe integer.",
    });
  });

  it("rejects a missing file and an invalid surface", async () => {
    const { task } = await seedTask();

    const missing = await upload(task.id, null);
    expect(missing.status).toBe(400);
    expect(await readErrorBody(missing)).toMatchObject({
      message: 'A file is required in the "file" field.',
    });

    const badSurface = await upload(task.id, undefined, { surface: "avatar" });
    expect(badSurface.status).toBe(400);
    expect(await readErrorBody(badSurface)).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(store.objects.size).toBe(0);
  });

  it("answers 413 above S3_MAX_IMAGE_UPLOAD_BYTES without storing anything", async () => {
    vi.stubEnv("S3_MAX_IMAGE_UPLOAD_BYTES", "64");
    const { task } = await seedTask();

    const response = await upload(task.id, {
      bytes: Buffer.alloc(65, 1),
      type: "application/octet-stream",
      name: "big.bin",
    });

    expect(response.status).toBe(413);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Upload exceeds the maximum upload size of 0MB.",
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(store.objects.size).toBe(0);
    expect(await app.db.find(AssetEntity)).toEqual([]);
  });

  it("refuses a JSON body with 415", async () => {
    const { task } = await seedTask();

    const response = await app.request(`/api/task/image-upload/${task.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "x.png",
        contentType: "image/png",
        size: 12,
        surface: "description",
      }),
    });

    expect(response.status).toBe(415);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Upload the file as multipart/form-data.",
      code: "HTTP_415",
    });
  });

  it("answers 503 when storage is not configured", async () => {
    const { task } = await seedTask();
    store.configured = false;

    const response = await upload(task.id);

    expect(response.status).toBe(503);
    expect((await readErrorBody(response)).message).toMatch(
      /^S3 uploads are not configured/,
    );
  });

  it("fails closed without provider details and leaves a cleanup intent when storage fails", async () => {
    const { task } = await seedTask();
    vi.spyOn(store, "put").mockRejectedValueOnce(
      new Error("https://storage.example.test/?credential=secret"),
    );

    const response = await upload(task.id);

    expect(response.status).toBe(503);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Unable to store the uploaded file.",
      code: "SERVICE_UNAVAILABLE",
    });
    expect(await app.db.find(AssetEntity)).toEqual([]);
    expect(await app.db.find(JobLeaseEntity)).toEqual([]);
    const intents = await app.db.find(StorageCleanupEntity);
    expect(intents).toHaveLength(1);
    expect(intents[0]?.objectKey).toContain(`/task/${task.id}/descriptions/`);
  });

  it("rejects unauthenticated requests", async () => {
    const { task } = await seedTask();
    app.auth.signOut();

    expect((await upload(task.id)).status).toBe(401);
  });

  it("rejects requests from users outside the workspace before reading the file", async () => {
    const { task } = await seedTask();
    const outsider = await createUser(app.db, { name: "Outsider" });
    app.auth.signIn(outsider);
    const put = vi.spyOn(store, "put");

    const response = await upload(task.id);

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Task not found",
      code: "NOT_FOUND",
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("requires task:update permission", async () => {
    const { task } = await seedTask("viewer");
    const put = vi.spyOn(store, "put");

    const response = await upload(task.id);

    expect(response.status).toBe(403);
    expect(put).not.toHaveBeenCalled();
    expect(await app.db.find(AssetEntity)).toEqual([]);
  });

  it("answers 404 for an unknown task", async () => {
    await seedTask();

    const response = await upload("missing-task");

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Task not found",
    });
  });
});
