import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProjectPhaseEntity } from "../../src/database/entities/project-phase.entity";
import { ProjectSprintEntity } from "../../src/database/entities/project-sprint.entity";
import { TaskEstimateAllocationEntity } from "../../src/database/entities/task-estimate-allocation.entity";
import { TaskRelationEntity } from "../../src/database/entities/task-relation.entity";
import { TimeEntryEntity } from "../../src/database/entities/time-entry.entity";
import { WorkspaceMemberCapacityEntity } from "../../src/database/entities/workspace-member-capacity.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous suite had no HTTP coverage for these reports: these pin the
// translated queries and the route wiring.
describe("API integration: time analytics", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  async function seed() {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
      userName: "Maya",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
      name: "Analytics",
    });
    const phase = await insertRow(app.db, ProjectPhaseEntity, {
      projectId: project.id,
      name: "Build",
    });
    await insertRow(app.db, ProjectPhaseEntity, {
      projectId: project.id,
      name: "Spec",
      kind: "document",
      parentId: phase.id,
    });
    const sprint = await insertRow(app.db, ProjectSprintEntity, {
      projectId: project.id,
      phaseId: phase.id,
      name: "Sprint 1",
    });
    const parent = await createTask(app.db, {
      projectId: project.id,
      title: "Parent",
      number: 1,
      estimatedMinutes: 999,
      phaseId: phase.id,
      sprintId: sprint.id,
    });
    const child = await createTask(app.db, {
      projectId: project.id,
      title: "Child",
      number: 2,
      estimatedMinutes: 60,
      status: "done",
    });
    await insertRow(app.db, TaskRelationEntity, {
      sourceTaskId: parent.id,
      targetTaskId: child.id,
      relationType: "subtask",
    });
    const closed = await insertRow(app.db, TimeEntryEntity, {
      taskId: child.id,
      userId: user.id,
      startTime: new Date("2026-01-05T09:00:00.000Z"),
      endTime: new Date("2026-01-05T11:00:00.000Z"),
      duration: 7200,
    });
    await insertRow(app.db, TimeEntryEntity, {
      taskId: parent.id,
      userId: user.id,
      startTime: new Date("2026-01-06T09:00:00.000Z"),
      endTime: null,
      duration: null,
    });
    await insertRow(app.db, TaskEstimateAllocationEntity, {
      taskId: child.id,
      userId: user.id,
      estimatedMinutes: 600,
    });
    app.auth.signIn(user);
    return { user, workspace, project, phase, sprint, parent, child, closed };
  }

  it("reports estimates against logged time with subtasks rolled up", async () => {
    const { project, phase, sprint, parent, child } = await seed();

    const response = await app.request(
      `/api/time-analytics/project/${project.id}`,
    );

    expect(response.status).toBe(200);
    const report = (await response.json()) as Record<string, unknown>;
    expect(report).toMatchObject({
      projectId: project.id,
      projectName: "Analytics",
      estimatedMinutes: 120,
      actualSeconds: 14400,
      taskCount: 2,
      completedTasks: 1,
      inProgressTasks: 1,
      tasksOverEstimate: 2,
      tasksMissingEstimate: 0,
      tasksWithoutTime: 0,
      phases: [
        {
          phaseId: phase.id,
          name: "Build",
          estimatedMinutes: 60,
          actualSeconds: 7200,
          taskCount: 1,
        },
      ],
      sprints: [
        {
          sprintId: sprint.id,
          name: "Sprint 1",
          phaseId: phase.id,
          taskCount: 1,
        },
      ],
    });
    expect(report.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: parent.id,
          estimatedMinutes: 60,
          actualSeconds: 7200,
          completed: false,
        }),
        expect.objectContaining({
          taskId: child.id,
          estimatedMinutes: 60,
          actualSeconds: 7200,
          completed: true,
          utilizationPercent: 200,
        }),
      ]),
    );

    const scoped = await app.request(
      `/api/time-analytics/project/${project.id}?sprintId=${sprint.id}`,
    );
    expect(await scoped.json()).toMatchObject({ taskCount: 1 });
  });

  it("lists closed entries as timesheet rows with their context", async () => {
    const { workspace, user, project, phase, sprint, child, closed } =
      await seed();

    const response = await app.request(
      `/api/time-analytics/timesheets?workspaceId=${workspace.id}&from=2026-01-01T00:00:00Z&to=2026-01-31T00:00:00Z`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: closed.id,
        taskId: child.id,
        userId: user.id,
        userName: "Maya",
        description: null,
        startTime: "2026-01-05T09:00:00.000Z",
        endTime: "2026-01-05T11:00:00.000Z",
        duration: 7200,
        createdAt: closed.createdAt.toISOString(),
        updatedAt: closed.updatedAt.toISOString(),
        taskTitle: "Child",
        taskNumber: 2,
        taskEstimatedMinutes: 60,
        projectId: project.id,
        projectName: "Analytics",
        phaseId: null,
        phaseName: null,
        sprintId: null,
        sprintName: null,
        userAllocatedMinutes: 600,
      },
    ]);

    const filtered = await app.request(
      `/api/time-analytics/timesheets?workspaceId=${workspace.id}&phaseId=${phase.id}&sprintId=${sprint.id}`,
    );
    expect(await filtered.json()).toEqual([]);
  });

  it("reports workload against each member's capacity", async () => {
    const { workspace, user } = await seed();
    await insertRow(app.db, WorkspaceMemberCapacityEntity, {
      workspaceId: workspace.id,
      userId: user.id,
      minutesPerDay: 300,
      workingDaysPerWeek: 4,
    });

    const response = await app.request(
      `/api/time-analytics/workload?workspaceId=${workspace.id}&from=2026-01-05T00:00:00Z&to=2026-01-11T00:00:00Z`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        userId: user.id,
        userName: "Maya",
        rangeCapacityMinutes: 1200,
        plannedMinutes: 600,
        actualSeconds: 7200,
        workloadPercent: 50,
        overloadedMinutes: 0,
        availableMinutes: 600,
        overEstimate: false,
        utilizationPercent: 20,
      },
    ]);

    const nobody = await app.request(
      `/api/time-analytics/workload?workspaceId=${workspace.id}&userId=missing&from=2026-01-05&to=2026-01-11`,
    );
    expect(nobody.status).toBe(404);
    expect((await readErrorBody(nobody)).message).toBe(
      "No workspace members found",
    );
  });

  it("requires the workspace and the report range", async () => {
    const { workspace, project } = await seed();
    expect(
      (await app.request("/api/time-analytics/timesheets")).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `/api/time-analytics/workload?workspaceId=${workspace.id}`,
        )
      ).status,
    ).toBe(400);

    const { user: outsider } = await createWorkspaceMember(app.db);
    app.auth.signIn(outsider);
    expect(
      (await app.request(`/api/time-analytics/project/${project.id}`)).status,
    ).toBe(404);
  });
});
