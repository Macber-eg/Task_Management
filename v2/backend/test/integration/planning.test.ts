import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { ProjectPhaseEntity } from "../../src/database/entities/project-phase.entity";
import { ProjectSprintEntity } from "../../src/database/entities/project-sprint.entity";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type Phase = { id: string; name: string; parentId: string | null } & Record<
  string,
  unknown
>;
type Sprint = { id: string; phaseId: string | null } & Record<string, unknown>;

// The previous suite had no coverage for these routes: these pin the
// translated queries, the hierarchy rules and the route wiring.
describe("API integration: planning", () => {
  let app: TestApp;

  function json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  async function project(flags: { phases?: boolean; sprints?: boolean } = {}) {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    await app.db.update(
      ProjectEntity,
      { id: project.id },
      {
        phasesEnabled: flags.phases ?? true,
        sprintsEnabled: flags.sprints ?? true,
      },
    );
    app.auth.signIn(user);
    return { user, workspace, project };
  }

  async function createPhase(projectId: string, body: unknown) {
    const response = await app.request(
      `/api/planning/phase/${projectId}`,
      json("POST", body),
    );
    return { response, phase: (await response.clone().json()) as Phase };
  }

  describe("phases", () => {
    it("creates folders and documents in position order and lists them", async () => {
      const { project: p } = await project();
      const { response, phase: folder } = await createPhase(p.id, {
        name: "  Discovery  ",
        startDate: "2026-02-01",
      });
      expect(response.status).toBe(200);
      expect(folder).toMatchObject({
        projectId: p.id,
        name: "Discovery",
        parentId: null,
        kind: "folder",
        position: 0,
        startDate: "2026-02-01T00:00:00.000Z",
        endDate: null,
        archivedAt: null,
      });
      const { phase: second } = await createPhase(p.id, { name: "Build" });
      expect(second.position).toBe(1);
      const { phase: doc } = await createPhase(p.id, {
        name: "Spec",
        kind: "document",
        parentId: folder.id,
      });
      expect(doc).toMatchObject({ parentId: folder.id, position: 0 });

      const list = await app.request(`/api/planning/phase/${p.id}`);
      expect(list.status).toBe(200);
      // Ordered by parent (top level, a NULL parent, sorts last), then position.
      expect(
        ((await list.json()) as Phase[]).map((phase) => phase.name),
      ).toEqual(["Spec", "Discovery", "Build"]);
    });

    it("refuses invalid hierarchies and disabled phases", async () => {
      const { project: p } = await project();
      const { phase: folder } = await createPhase(p.id, { name: "Folder" });
      const { phase: doc } = await createPhase(p.id, {
        name: "Doc",
        kind: "document",
        parentId: folder.id,
      });
      const message = async (response: Response) =>
        (await readErrorBody(response)).message;

      expect(
        await message(
          (await createPhase(p.id, { name: "Loose", kind: "document" }))
            .response,
        ),
      ).toBe("Documents must live inside a folder");
      expect(
        await message(
          (await createPhase(p.id, { name: "Nested", parentId: doc.id }))
            .response,
        ),
      ).toBe("Documents cannot contain nested items");
      expect(
        await message(
          (await createPhase(p.id, { name: "Lost", parentId: "missing" }))
            .response,
        ),
      ).toBe("Parent folder not found in this project");

      const { phase: child } = await createPhase(p.id, {
        name: "Child",
        parentId: folder.id,
      });
      const self = await app.request(
        `/api/planning/phase/${folder.id}`,
        json("PUT", { parentId: folder.id }),
      );
      expect(await message(self)).toBe("A folder cannot be its own parent");
      const cycle = await app.request(
        `/api/planning/phase/${folder.id}`,
        json("PUT", { parentId: child.id }),
      );
      expect(await message(cycle)).toBe(
        "Cannot move a folder inside its own descendant",
      );

      const { project: disabled } = await project({ phases: false });
      const refused = await createPhase(disabled.id, { name: "Nope" });
      expect(refused.response.status).toBe(403);
      expect(await message(refused.response)).toBe(
        "Phases are not enabled for this project",
      );
    });

    it("updates, archives, reorders and deletes phases", async () => {
      const { project: p } = await project();
      const { phase: a } = await createPhase(p.id, { name: "A" });
      const { phase: b } = await createPhase(p.id, { name: "B" });

      const renamed = await app.request(
        `/api/planning/phase/${a.id}`,
        json("PUT", { name: "Alpha", endDate: "2026-03-01T00:00:00Z" }),
      );
      expect(await renamed.json()).toMatchObject({
        name: "Alpha",
        endDate: "2026-03-01T00:00:00.000Z",
      });
      const invalidDate = await app.request(
        `/api/planning/phase/${a.id}`,
        json("PUT", { startDate: "soon" }),
      );
      expect((await readErrorBody(invalidDate)).message).toBe(
        "Invalid startDate",
      );

      const reordered = await app.request(
        `/api/planning/phase/reorder/${p.id}`,
        json("PUT", {
          phases: [
            { id: a.id, position: 1 },
            { id: b.id, position: 0 },
          ],
        }),
      );
      expect(reordered.status).toBe(200);
      expect(((await reordered.json()) as Phase[]).map((x) => x.id)).toEqual([
        b.id,
        a.id,
      ]);
      const foreign = await app.request(
        `/api/planning/phase/reorder/${p.id}`,
        json("PUT", { phases: [{ id: "missing", position: 0 }] }),
      );
      expect((await readErrorBody(foreign)).message).toBe(
        "Folder missing does not belong to this project",
      );

      const archived = await app.request(
        `/api/planning/phase/${b.id}`,
        json("PUT", { archived: true }),
      );
      expect(
        ((await archived.json()) as Phase).archivedAt,
      ).not.toBeNull();
      const listed = await app.request(`/api/planning/phase/${p.id}`);
      expect(((await listed.json()) as Phase[]).map((x) => x.id)).toEqual([
        a.id,
      ]);

      const deleted = await app.request(`/api/planning/phase/${a.id}`, {
        method: "DELETE",
      });
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toMatchObject({ id: a.id });
      expect(
        await app.db.countBy(ProjectPhaseEntity, { id: a.id }),
      ).toBe(0);
      const gone = await app.request(`/api/planning/phase/${a.id}`, {
        method: "DELETE",
      });
      expect(gone.status).toBe(404);
    });
  });

  describe("sprints", () => {
    it("ties sprints to a phase when phases are enabled", async () => {
      const { project: p } = await project();
      const { phase } = await createPhase(p.id, { name: "Build" });

      const loose = await app.request(
        `/api/planning/sprint/${p.id}`,
        json("POST", { name: "Sprint" }),
      );
      expect(loose.status).toBe(400);
      expect((await readErrorBody(loose)).message).toBe(
        "Sprints must belong to a phase when phases are enabled",
      );

      const created = await app.request(
        `/api/planning/sprint/${p.id}`,
        json("POST", {
          name: " Sprint 1 ",
          phaseId: phase.id,
          goal: "  ",
          status: "active",
        }),
      );
      expect(created.status).toBe(200);
      expect(await created.json()).toMatchObject({
        projectId: p.id,
        phaseId: phase.id,
        name: "Sprint 1",
        goal: null,
        status: "active",
        position: 0,
      });

      const foreignPhase = await app.request(
        `/api/planning/sprint/${p.id}`,
        json("POST", { name: "Sprint 2", phaseId: "missing" }),
      );
      expect((await readErrorBody(foreignPhase)).message).toBe(
        "Phase does not belong to this project",
      );
    });

    it("creates, updates, reorders and deletes sprints without phases", async () => {
      const { project: p } = await project({ phases: false });
      const make = async (name: string) =>
        (await (
          await app.request(
            `/api/planning/sprint/${p.id}`,
            json("POST", { name }),
          )
        ).json()) as Sprint;
      const one = await make("One");
      const two = await make("Two");
      expect(two.position).toBe(1);

      const updated = await app.request(
        `/api/planning/sprint/${one.id}`,
        json("PUT", { goal: " Ship ", status: "completed" }),
      );
      expect(await updated.json()).toMatchObject({
        goal: "Ship",
        status: "completed",
      });
      const unchanged = await app.request(
        `/api/planning/sprint/${one.id}`,
        json("PUT", {}),
      );
      expect(await unchanged.json()).toMatchObject({ id: one.id });

      const reordered = await app.request(
        `/api/planning/sprint/reorder/${p.id}`,
        json("PUT", {
          sprints: [
            { id: one.id, position: 5 },
            { id: two.id, position: 2 },
          ],
        }),
      );
      expect(((await reordered.json()) as Sprint[]).map((s) => s.id)).toEqual(
        [two.id, one.id],
      );

      const list = await app.request(`/api/planning/sprint/${p.id}`);
      expect(((await list.json()) as Sprint[]).map((s) => s.id)).toEqual([
        two.id,
        one.id,
      ]);

      const deleted = await app.request(`/api/planning/sprint/${one.id}`, {
        method: "DELETE",
      });
      expect(deleted.status).toBe(200);
      expect(await app.db.count(ProjectSprintEntity)).toBe(1);

      const { project: disabled } = await project({ sprints: false });
      const refused = await app.request(
        `/api/planning/sprint/${disabled.id}`,
        json("POST", { name: "Nope" }),
      );
      expect(refused.status).toBe(403);
    });
  });

  it("requires project:update to change planning", async () => {
    const { workspace, project: p } = await project();
    const member = await createUser(app.db);
    await addWorkspaceMember(app.db, workspace.id, member.id, "member");
    app.auth.signIn(member);

    expect((await app.request(`/api/planning/phase/${p.id}`)).status).toBe(
      200,
    );
    expect((await createPhase(p.id, { name: "No" })).response.status).toBe(
      403,
    );
    const invalid = await app.request(
      `/api/planning/phase/${p.id}`,
      json("POST", { name: "" }),
    );
    expect(invalid.status).toBe(403);
  });
});
