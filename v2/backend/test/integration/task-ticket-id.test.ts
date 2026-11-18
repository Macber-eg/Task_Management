import { In } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { WorkspaceEntity } from "../../src/database/entities/workspace.entity";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

function lookup(path: string) {
  return app.request(`/api/task/by-ticket-id/${path}`);
}

describe("API integration: task ticket ID lookup", () => {
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("returns the exact accessible task with full details", async () => {
    const member = await createWorkspaceMember(app.db);
    const outsider = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "DE_",
    });
    const { project: nearMatch } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "DEX",
    });
    const { project: privateProject } = await createProjectFixture(app.db, {
      workspaceId: outsider.workspace.id,
      slug: "DE_",
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Direct match",
      description: "Full description",
      number: 23,
      userId: member.user.id,
    });
    await createTask(app.db, {
      projectId: nearMatch.id,
      title: "Wildcard match",
      number: 23,
    });
    await createTask(app.db, {
      projectId: privateProject.id,
      title: "Private match",
      number: 23,
    });

    app.auth.signIn(member.user);
    const response = await lookup("de_-23");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: task.id,
      title: "Direct match",
      description: "Full description",
      assigneeName: member.user.name,
      projectId: project.id,
      workspaceId: member.workspace.id,
      number: 23,
    });
    const missing = await lookup("DE_-24");
    expect(missing.status).toBe(404);
    const privateSelection = await lookup(
      `DE_-23?workspaceId=${outsider.workspace.id}`,
    );
    expect(privateSelection.status).toBe(404);
    const privateSlug = await lookup(
      `DE_-23?workspaceSlug=${outsider.workspace.slug}`,
    );
    expect(privateSlug.status).toBe(404);
  });

  it("disambiguates accessible tasks by workspace or project", async () => {
    const member = await createWorkspaceMember(app.db);
    const other = await createWorkspaceMember(app.db);
    await addWorkspaceMember(app.db, other.workspace.id, member.user.id);
    const first = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "KAN",
    });
    const duplicate = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "kan",
    });
    const second = await createProjectFixture(app.db, {
      workspaceId: other.workspace.id,
      slug: "KAN",
    });
    await createTask(app.db, {
      projectId: first.project.id,
      title: "First",
      number: 12,
    });
    await createTask(app.db, {
      projectId: duplicate.project.id,
      title: "Duplicate",
      number: 12,
    });
    await createTask(app.db, {
      projectId: second.project.id,
      title: "Second",
      number: 12,
    });

    app.auth.signIn(member.user);
    const ambiguous = await lookup("KAN-12");
    expect(ambiguous.status).toBe(409);
    const ambiguousInWorkspace = await lookup(
      `KAN-12?workspaceId=${member.workspace.id}`,
    );
    expect(ambiguousInWorkspace.status).toBe(409);

    const chosenProject = await lookup(
      `KAN-12?projectId=${duplicate.project.id}`,
    );
    expect(chosenProject.status).toBe(200);
    expect(await chosenProject.json()).toMatchObject({ title: "Duplicate" });

    const selected = await lookup(`KAN-12?workspaceId=${other.workspace.id}`);
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({
      title: "Second",
      workspaceId: other.workspace.id,
    });

    const bySlug = await lookup(`KAN-12?workspaceSlug=${other.workspace.slug}`);
    expect(bySlug.status).toBe(200);
    const byUpperSlug = await lookup(
      `KAN-12?workspaceSlug=${other.workspace.slug.toUpperCase()}`,
    );
    expect(byUpperSlug.status).toBe(200);
    expect(await bySlug.json()).toMatchObject({ title: "Second" });
    const unknownSlug = await lookup("KAN-12?workspaceSlug=no-such-workspace");
    expect(unknownSlug.status).toBe(404);
  });

  it("accepts a ticket ID generated from a numeric-leading project name", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "123",
    });
    await createTask(app.db, {
      projectId: project.id,
      title: "Numeric key",
      number: 1,
    });

    app.auth.signIn(member.user);
    const response = await lookup("123-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: "Numeric key" });
  });

  it("prefers an exact workspace slug over a case-insensitive match", async () => {
    const member = await createWorkspaceMember(app.db);
    const other = await createWorkspaceMember(app.db);
    await addWorkspaceMember(app.db, other.workspace.id, member.user.id);
    await app.db.update(
      WorkspaceEntity,
      { id: member.workspace.id },
      { slug: "case-ws" },
    );
    await app.db.update(
      WorkspaceEntity,
      { id: other.workspace.id },
      { slug: "CASE-WS" },
    );
    const lower = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "KAN",
    });
    const upper = await createProjectFixture(app.db, {
      workspaceId: other.workspace.id,
      slug: "KAN",
    });
    await createTask(app.db, {
      projectId: lower.project.id,
      title: "Lower",
      number: 12,
    });
    await createTask(app.db, {
      projectId: upper.project.id,
      title: "Upper",
      number: 12,
    });

    app.auth.signIn(member.user);
    const exactLower = await lookup("KAN-12?workspaceSlug=case-ws");
    expect(await exactLower.json()).toMatchObject({ title: "Lower" });
    const exactUpper = await lookup("KAN-12?workspaceSlug=CASE-WS");
    expect(await exactUpper.json()).toMatchObject({ title: "Upper" });
    const mixed = await lookup("KAN-12?workspaceSlug=Case-Ws");
    expect(mixed.status).toBe(409);
  });

  it("resolves a project key outside the generated key format", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "OPS.2",
    });
    await createTask(app.db, {
      projectId: project.id,
      title: "Dotted key",
      number: 12,
    });

    app.auth.signIn(member.user);
    const response = await lookup("OPS.2-12");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: "Dotted key" });
  });

  it("resolves a full-width project key as stored", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "ＡＢＣ",
    });
    await createTask(app.db, {
      projectId: project.id,
      title: "Full-width key",
      number: 1,
    });

    app.auth.signIn(member.user);
    const response = await lookup(encodeURIComponent("ＡＢＣ-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: "Full-width key" });
    const normalized = await lookup("abc-1");
    expect(normalized.status).toBe(200);
    expect(await normalized.json()).toMatchObject({ title: "Full-width key" });
  });

  it("prefers an active project over an archived one sharing its key", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project: active } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "ARC",
    });
    const { project: archived } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "arc",
    });
    const { project: alsoArchived } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "Arc",
    });
    await app.db.update(
      ProjectEntity,
      { id: In([archived.id, alsoArchived.id]) },
      { archivedAt: new Date() },
    );
    for (const [projectId, title, number] of [
      [active.id, "Active", 5],
      [archived.id, "Archived", 5],
      [alsoArchived.id, "Also archived", 5],
      [archived.id, "Archived only", 6],
      [alsoArchived.id, "Also archived only", 6],
    ] as const) {
      await createTask(app.db, { projectId, title, number });
    }

    app.auth.signIn(member.user);
    const preferred = await lookup("ARC-5");
    expect(preferred.status).toBe(200);
    expect(await preferred.json()).toMatchObject({ title: "Active" });
    const archivedOnly = await lookup("ARC-6");
    expect(archivedOnly.status).toBe(409);

    await app.db.update(
      ProjectEntity,
      { id: active.id },
      { archivedAt: new Date(Date.now() + 60_000) },
    );
    const afterArchiving = await lookup("ARC-5");
    expect(afterArchiving.status).toBe(200);
    expect(await afterArchiving.json()).toMatchObject({ title: "Active" });
  });

  it("rejects invalid and unauthenticated lookups", async () => {
    const member = await createWorkspaceMember(app.db);
    app.auth.signIn(member.user);

    for (const ticketId of ["KAN-0", "KAN-2147483648", "bad-id"]) {
      const response = await lookup(ticketId);
      expect(response.status).toBe(400);
    }

    app.auth.signOut();
    const anonymous = await lookup("KAN-12");
    expect(anonymous.status).toBe(401);
  });
});
