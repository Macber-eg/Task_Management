import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { EventBus } from "../../src/events/event-bus";
import { RealtimeConnections } from "../../src/realtime/realtime-connections";
import { WorkspaceMemberLifecycleService } from "../../src/workspace-members/workspace-member-lifecycle.service";
import { WorkspaceSeatSync } from "../../src/workspace-members/workspace-seat-sync";
import { createRestrictedWorkspace } from "../support/fixtures/create-restricted-workspace";
import { readMemberAccessRows } from "../support/fixtures/read-member-access-rows";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The organization endpoints (remove member, update role, create workspace)
// call these; this pins what each one does on its own.
describe("workspace member lifecycle", () => {
  const revokeWorkspaceConnections =
    vi.fn<RealtimeConnections["revokeWorkspaceConnections"]>();
  const syncWorkspaceSeats = vi.fn<WorkspaceSeatSync["syncWorkspaceSeats"]>();
  const events: { type: string; data: Record<string, unknown> }[] = [];
  let app: TestApp;
  let lifecycle: WorkspaceMemberLifecycleService;

  beforeAll(async () => {
    app = await createTestApp({
      overrides: [
        [RealtimeConnections, { revokeWorkspaceConnections }],
        [WorkspaceSeatSync, { syncWorkspaceSeats }],
      ],
    });
    lifecycle = app.get(WorkspaceMemberLifecycleService);
    for (const type of ["project_members.updated", "project_access.updated"]) {
      app
        .get(EventBus)
        .subscribe<Record<string, unknown>>(type, async (data) => {
          events.push({ type, data });
        });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    revokeWorkspaceConnections.mockReset().mockResolvedValue(undefined);
    syncWorkspaceSeats.mockReset().mockResolvedValue(undefined);
    events.length = 0;
  });

  it("announces the projects a new member can see and syncs seats", async () => {
    const ctx = await createRestrictedWorkspace(app.db);

    await lifecycle.handleMemberAdded(ctx.workspace.id, ctx.restricted.id);

    expect(events).toEqual([
      {
        type: "project_members.updated",
        data: { workspaceId: ctx.workspace.id, projectIds: [ctx.alpha.id] },
      },
    ]);
    expect(syncWorkspaceSeats).toHaveBeenCalledExactlyOnceWith(
      ctx.workspace.id,
    );
  });

  it("clears a removed member's project access and drops their connections", async () => {
    const ctx = await createRestrictedWorkspace(app.db);

    await lifecycle.handleMemberRemoved({
      workspaceId: ctx.workspace.id,
      userId: ctx.restricted.id,
      userRole: null,
    });

    expect(
      await readMemberAccessRows(app.db, ctx.workspace.id, ctx.restricted.id),
    ).toEqual({ rules: [], grants: [] });
    expect(events).toEqual([
      {
        type: "project_members.updated",
        data: { workspaceId: ctx.workspace.id },
      },
    ]);
    expect(revokeWorkspaceConnections).toHaveBeenCalledExactlyOnceWith(
      ctx.restricted.id,
      ctx.workspace.id,
      { role: null },
    );
    expect(syncWorkspaceSeats).toHaveBeenCalledExactlyOnceWith(
      ctx.workspace.id,
    );
  });

  it("keeps a removed instance admin's connections", async () => {
    const ctx = await createRestrictedWorkspace(app.db);

    await lifecycle.handleMemberRemoved({
      workspaceId: ctx.workspace.id,
      userId: ctx.restricted.id,
      userRole: "user,admin",
    });

    expect(revokeWorkspaceConnections).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "project_members.updated",
    ]);
  });

  it("clears a member's project limit when they become an owner", async () => {
    const ctx = await createRestrictedWorkspace(app.db);

    await lifecycle.handleOwnerPromoted(ctx.workspace.id, ctx.restricted.id);

    expect(
      await readMemberAccessRows(app.db, ctx.workspace.id, ctx.restricted.id),
    ).toEqual({ rules: [], grants: [] });
    expect(events).toEqual([
      {
        type: "project_access.updated",
        data: { workspaceId: ctx.workspace.id, userId: ctx.restricted.id },
      },
    ]);
  });

  it("does not let a failing seat sync fail the membership change", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    syncWorkspaceSeats.mockRejectedValue(new Error("billing is down"));

    await expect(
      lifecycle.handleMemberAdded(ctx.workspace.id, ctx.restricted.id),
    ).resolves.toBeUndefined();
  });
});
