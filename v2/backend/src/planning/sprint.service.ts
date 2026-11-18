import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import {
  deleteReturning,
  insertReturning,
  updateReturning,
} from "../database/dml";
import { ProjectSprintEntity } from "../database/entities/project-sprint.entity";
import { parsePlanningDate } from "./parse-planning-date";
import {
  assertPhaseInProject,
  assertSprintsEnabled,
  getProjectPlanningFlags,
} from "./planning-guards";
import type { CreateSprintInput, UpdateSprintInput } from "./schema";

@Injectable()
export class SprintService {
  constructor(private readonly dataSource: DataSource) {}

  getSprints(projectId: string) {
    return this.dataSource.manager.find(ProjectSprintEntity, {
      where: { projectId },
      order: { position: "ASC", id: "ASC" },
    });
  }

  /** With phases enabled, a sprint must belong to one of the project's phases. */
  async createSprint({
    projectId,
    phaseId,
    name,
    goal,
    status,
    startDate,
    endDate,
  }: CreateSprintInput & { projectId: string }) {
    const manager = this.dataSource.manager;
    await assertSprintsEnabled(manager, projectId);

    const flags = await getProjectPlanningFlags(manager, projectId);
    const nextPhaseId = phaseId?.trim() || null;
    if (flags.phasesEnabled && !nextPhaseId) {
      throw new HTTPException(400, {
        message: "Sprints must belong to a phase when phases are enabled",
      });
    }
    if (nextPhaseId) {
      await assertPhaseInProject(manager, nextPhaseId, projectId);
    }

    const trimmed = name.trim();
    if (!trimmed) {
      throw new HTTPException(400, { message: "Sprint name is required" });
    }

    const [maxPos] = (await (nextPhaseId
      ? manager.query(
          `SELECT coalesce(max(position), -1) AS maximum FROM project_sprint
           WHERE project_id = $1 AND phase_id = $2`,
          [projectId, nextPhaseId],
        )
      : manager.query(
          `SELECT coalesce(max(position), -1) AS maximum FROM project_sprint
           WHERE project_id = $1`,
          [projectId],
        ))) as { maximum: number | string }[];

    const sprint = await insertReturning(manager, ProjectSprintEntity, {
      projectId,
      phaseId: nextPhaseId,
      name: trimmed,
      goal: goal?.trim() || null,
      status: status ?? "planned",
      position: Number(maxPos?.maximum ?? -1) + 1,
      startDate: parsePlanningDate(startDate, "startDate"),
      endDate: parsePlanningDate(endDate, "endDate"),
    });

    if (!sprint) {
      throw new HTTPException(500, { message: "Failed to create sprint" });
    }

    return sprint;
  }

  async updateSprint(id: string, body: UpdateSprintInput) {
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(ProjectSprintEntity, {
      where: { id },
    });

    if (!existing) {
      throw new HTTPException(404, { message: "Sprint not found" });
    }

    const updates: Partial<
      Pick<
        ProjectSprintEntity,
        "name" | "goal" | "phaseId" | "status" | "startDate" | "endDate"
      >
    > = {};

    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (!trimmed) {
        throw new HTTPException(400, { message: "Sprint name is required" });
      }
      updates.name = trimmed;
    }
    if (body.goal !== undefined) {
      updates.goal = body.goal?.trim() || null;
    }
    if (body.phaseId !== undefined) {
      const nextPhaseId = body.phaseId?.trim() || null;
      if (nextPhaseId) {
        await assertPhaseInProject(manager, nextPhaseId, existing.projectId);
      }
      updates.phaseId = nextPhaseId;
    }
    if (body.status !== undefined) {
      updates.status = body.status;
    }
    if (body.startDate !== undefined) {
      updates.startDate = parsePlanningDate(body.startDate, "startDate");
    }
    if (body.endDate !== undefined) {
      updates.endDate = parsePlanningDate(body.endDate, "endDate");
    }

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const [sprint] = await updateReturning(
      manager,
      ProjectSprintEntity,
      updates,
      { id },
    );

    if (!sprint) {
      throw new HTTPException(500, { message: "Failed to update sprint" });
    }

    return sprint;
  }

  async deleteSprint(id: string) {
    const [sprint] = await deleteReturning(
      this.dataSource.manager,
      ProjectSprintEntity,
      { id },
    );

    if (!sprint) {
      throw new HTTPException(404, { message: "Sprint not found" });
    }

    return sprint;
  }
}
