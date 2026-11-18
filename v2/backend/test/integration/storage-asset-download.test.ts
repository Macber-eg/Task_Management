import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AssetEntity } from "../../src/database/entities/asset.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { ObjectStore } from "../../src/storage/object-store/object-store";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { restrictToProjects } from "../support/fixtures/restrict-to-projects";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createUser } from "../support/fixtures/create-user";
import { PNG_BYTES } from "../support/fixtures/storage-files";
import { InMemoryObjectStore } from "../support/in-memory-object-store";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api-integration/asset-visibility.test.ts and the asset
// case of api-key-mixed-credentials.test.ts, plus the response headers of
// GET /asset/{id} in apps/api/src/index.ts.
describe("API integration: asset downloads", () => {
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
    vi.restoreAllMocks();
  });

  async function seedAsset(
    values: Partial<AssetEntity> & { workspaceId: string; projectId: string },
    body: Buffer = PNG_BYTES,
  ) {
    const objectKey = values.objectKey ?? `synthetic/${randomUUID()}`;
    await store.put(objectKey, body, values.mimeType ?? "image/png");
    return insertRow(app.db, AssetEntity, {
      objectKey,
      filename: "image.png",
      mimeType: "image/png",
      size: body.length,
      surface: "description",
      ...values,
    });
  }

  it("serves public descriptions but denies anonymous and other-workspace access to comment assets", async () => {
    const member = await createWorkspaceMember(app.db);
    const outsider = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    await app.db.update(ProjectEntity, { id: project.id }, { isPublic: true });
    const scope = { workspaceId: member.workspace.id, projectId: project.id };
    const description = await seedAsset({
      ...scope,
      surface: "description",
      createdBy: member.user.id,
    });
    const comment = await seedAsset({
      ...scope,
      surface: "comment",
      createdBy: member.user.id,
    });
    const get = vi.spyOn(store, "get");

    app.auth.signOut();
    const publicResponse = await app.request(`/api/asset/${description.id}`);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toMatch(/^public,/);
    expect(Buffer.from(await publicResponse.arrayBuffer())).toEqual(PNG_BYTES);
    expect((await app.request(`/api/asset/${comment.id}`)).status).toBe(401);
    expect(get).toHaveBeenCalledTimes(1);

    app.auth.signIn(outsider.user);
    const foreign = await app.request(`/api/asset/${comment.id}`);
    expect(foreign.status).toBe(404);
    expect(await readErrorBody(foreign)).toMatchObject({
      message: "Asset not found",
    });
    expect(get).toHaveBeenCalledTimes(1);

    app.auth.signIn(member.user);
    const privateResponse = await app.request(`/api/asset/${comment.id}`);
    expect(privateResponse.status).toBe(200);
    expect(privateResponse.headers.get("cache-control")).toMatch(/^private,/);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("serves images inline with their stored headers", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const asset = await seedAsset({
      workspaceId: member.workspace.id,
      projectId: project.id,
      filename: "Résumé photo.png",
    });
    app.auth.signIn(member.user);

    const response = await app.request(`/api/asset/${asset.id}`);

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "cache-control": "private, max-age=120",
      "content-disposition": `inline; filename="Resume photo.png"; filename*=UTF-8''R%C3%A9sum%C3%A9%20photo.png`,
      "content-length": String(PNG_BYTES.length),
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
    });
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
    expect(response.headers.get("last-modified")).toBeTruthy();
  });

  it("downloads everything else as an octet-stream attachment", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const html = Buffer.from("<script>alert(1)</script>");
    const asset = await seedAsset(
      {
        workspaceId: member.workspace.id,
        projectId: project.id,
        filename: "page.html",
        mimeType: "text/html",
        kind: "attachment",
      },
      html,
    );
    app.auth.signIn(member.user);

    const response = await app.request(`/api/asset/${asset.id}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="page.html"; filename*=UTF-8''page.html`,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(html);
  });

  it("answers 404 for an unknown asset and for a missing object", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const asset = await seedAsset({
      workspaceId: member.workspace.id,
      projectId: project.id,
    });
    store.objects.delete(asset.objectKey);
    app.auth.signIn(member.user);

    const unknown = await app.request("/api/asset/missing");
    expect(unknown.status).toBe(404);
    expect(await readErrorBody(unknown)).toMatchObject({
      message: "Asset not found",
    });

    const missingObject = await app.request(`/api/asset/${asset.id}`);
    expect(missingObject.status).toBe(404);
    expect(await readErrorBody(missingObject)).toMatchObject({
      message: "Asset object not found",
    });
  });

  it("keeps staged uploads private to their owner, even in public projects", async () => {
    const owner = await createWorkspaceMember(app.db);
    const colleague = await createUser(app.db);
    await addWorkspaceMember(app.db, owner.workspace.id, colleague.id);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });
    await app.db.update(ProjectEntity, { id: project.id }, { isPublic: true });
    const draft = await seedAsset({
      workspaceId: owner.workspace.id,
      projectId: project.id,
      surface: "draft",
      createdBy: owner.user.id,
    });

    app.auth.signOut();
    expect((await app.request(`/api/asset/${draft.id}`)).status).toBe(401);

    app.auth.signIn(colleague);
    const response = await app.request(`/api/asset/${draft.id}`);
    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Staged uploads are private to their owner",
    });

    app.auth.signIn(owner.user);
    expect((await app.request(`/api/asset/${draft.id}`)).status).toBe(200);
  });

  it("requires access to the asset's project", async () => {
    const owner = await createWorkspaceMember(app.db);
    const restricted = await createUser(app.db);
    await addWorkspaceMember(app.db, owner.workspace.id, restricted.id);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });
    const other = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
      slug: "other",
    });
    await restrictToProjects(app.db, owner.workspace.id, restricted.id, [
      other.project.id,
    ]);
    const asset = await seedAsset({
      workspaceId: owner.workspace.id,
      projectId: project.id,
    });

    app.auth.signIn(restricted);
    const response = await app.request(`/api/asset/${asset.id}`);

    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toMatchObject({
      message: "You don't have access to this project",
    });
  });
});

describe("API integration: asset downloads with real credentials", () => {
  const store = new InMemoryObjectStore();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      realAuth: true,
      overrides: [[ObjectStore, store]],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    store.reset();
  });

  it("accepts an API key but rejects it beside an invalid bearer token", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const objectKey = randomUUID();
    await store.put(objectKey, PNG_BYTES, "image/png");
    const asset = await insertRow(app.db, AssetEntity, {
      workspaceId: workspace.id,
      projectId: project.id,
      objectKey,
      filename: "image.png",
      mimeType: "image/png",
      size: PNG_BYTES.length,
      surface: "comment",
      createdBy: user.id,
    });
    const { key } = await seedApiKey(app.db, user.id);

    const keyOnly = await app.request(`/api/asset/${asset.id}`, {
      headers: { "x-api-key": key },
    });
    expect(keyOnly.status).toBe(200);

    const mixed = await app.request(`/api/asset/${asset.id}`, {
      headers: { "x-api-key": key, Authorization: "Bearer not-a-real-token" },
    });
    expect(mixed.status).toBe(401);

    expect((await app.request(`/api/asset/${asset.id}`)).status).toBe(401);
  });
});
