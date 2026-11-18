import { Injectable } from "@nestjs/common";
import { DataSource, IsNull } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import {
  deleteReturning,
  insertReturning,
  updateReturning,
} from "../database/dml";
import { ProjectPhaseEntity } from "../database/entities/project-phase.entity";
import { parsePlanningDate } from "./parse-planning-date";
import { assertValidPhaseParent, nextPhasePosition } from "./phase-parent";
import { assertPhasesEnabled } from "./planning-guards";
import type { CreatePhaseInput, UpdatePhaseInput } from "./schema";

/** Phases are a project's folders and documents. */
@Injectable()
export class PhaseService {
  constructor(private readonly dataSource: DataSource) {}

  getPhases(projectId: string, includeArchived = false) {
    return this.dataSource.manager.find(ProjectPhaseEntity, {
      where: includeArchived
        ? { projectId }
        : { projectId, archivedAt: IsNull() },
      order: { parentId: "ASC", position: "ASC", id: "ASC" },
    });
  }

  async createPhase({
    projectId,
    name,
    parentId,
    kind,
    startDate,
    endDate,
  }: CreatePhaseInput & { projectId: string }) {
    const manager = this.dataSource.manager;
    await assertPhasesEnabled(manager, projectId);

    const trimmed = name.trim();
    if (!trimmed) {
      throw new HTTPException(400, { message: "Phase name is required" });
    }

    const resolvedParentId =
      parentId === undefined || parentId === "" ? null : parentId;
    await assertValidPhaseParent(manager, {
      projectId,
      parentId: resolvedParentId,
    });

    const resolvedKind = kind ?? "folder";
    if (resolvedKind === "document" && resolvedParentId === null) {
      throw new HTTPException(400, {
        message: "Documents must live inside a folder",
      });
    }

    const position = await nextPhasePosition(
      manager,
      projectId,
      resolvedParentId,
    );

    const phase = await insertReturning(manager, ProjectPhaseEntity, {
      projectId,
      name: trimmed,
      parentId: resolvedParentId,
      kind: resolvedKind,
      position,
      startDate: parsePlanningDate(startDate, "startDate"),
      endDate: parsePlanningDate(endDate, "endDate"),
    });

    if (!phase) {
      throw new HTTPException(500, { message: "Failed to create phase" });
    }

    return phase;
  }

  async updatePhase(id: string, body: UpdatePhaseInput) {
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(ProjectPhaseEntity, {
      where: { id },
    });

    if (!existing) {
      throw new HTTPException(404, { message: "Phase not found" });
    }

    const updates: Partial<
      Pick<
        ProjectPhaseEntity,
        | "name"
        | "startDate"
        | "endDate"
        | "parentId"
        | "kind"
        | "position"
        | "archivedAt"
      >
    > = {};

    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (!trimmed) {
        throw new HTTPException(400, { message: "Phase name is required" });
      }
      updates.name = trimmed;
    }
    if (body.startDate !== undefined) {
      updates.startDate = parsePlanningDate(body.startDate, "startDate");
    }
    if (body.endDate !== undefined) {
      updates.endDate = parsePlanningDate(body.endDate, "endDate");
    }
    if (body.parentId !== undefined) {
      const resolvedParentId = body.parentId === "" ? null : body.parentId;
      await assertValidPhaseParent(manager, {
        projectId: existing.projectId,
        parentId: resolvedParentId,
        phaseId: id,
      });
      updates.parentId = resolvedParentId;
    }
    if (body.kind !== undefined) {
      updates.kind = body.kind;
    }
    if (body.position !== undefined) {
      updates.position = body.position;
    }
    if (body.archived !== undefined) {
      updates.archivedAt = body.archived ? new Date() : null;
    }

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const [phase] = await updateReturning(
      manager,
      ProjectPhaseEntity,
      updates,
      { id },
    );

    if (!phase) {
      throw new HTTPException(500, { message: "Failed to update phase" });
    }

    return phase;
  }

  async deletePhase(id: string) {
    const [phase] = await deleteReturning(
      this.dataSource.manager,
      ProjectPhaseEntity,
      { id },
    );

    if (!phase) {
      throw new HTTPException(404, { message: "Phase not found" });
    }

    return phase;
  }
}
