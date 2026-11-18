import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { TaskMutationEffects } from "../../effects/task-mutation-effects.service";
import {
  assertPhaseInProject,
  assertSprintInProject,
  getProjectPlanningFlags,
} from "../../../planning/planning-guards";
import { findSprintPhaseId } from "../../shared/find-sprint-phase-id";
import type { TaskRow } from "../../shared/task-row";
import { updateTask } from "../../shared/task-writes";
import { withLockedTask } from "../../shared/with-locked-task";

type Write = { id: string; currentUserId: string };

/** Delivery phase and sprint, which constrain each other. */
@Injectable()
export class TaskPlanningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly effects: TaskMutationEffects,
  ) {}

  async updateTaskPhase({
    id,
    phaseId,
    currentUserId,
  }: Write & { phaseId: string | null }) {
    const { before, after } = await withLockedTask(
      this.dataSource,
      id,
      async (tx, existingTask): Promise<TaskRow> => {
        const nextPhaseId = phaseId?.trim() || null;

        const flags = await getProjectPlanningFlags(tx, existingTask.projectId);
        if (!flags.phasesEnabled) {
          throw new HTTPException(403, {
            message: "Phases are not enabled for this project",
          });
        }

        if (nextPhaseId) {
          await assertPhaseInProject(tx, nextPhaseId, existingTask.projectId);
        }

        // A sprint planned inside another phase does not follow the task.
        let nextSprintId = existingTask.sprintId;
        if (existingTask.sprintId) {
          const sprintPhaseId = await findSprintPhaseId(
            tx,
            existingTask.sprintId,
          );
          if (sprintPhaseId && sprintPhaseId !== nextPhaseId) {
            nextSprintId = null;
          }
        }

        if (
          existingTask.phaseId === nextPhaseId &&
          existingTask.sprintId === nextSprintId
        ) {
          return existingTask;
        }

        const updatedTask = await updateTask(tx, id, {
          phaseId: nextPhaseId,
          sprintId: nextSprintId,
        });

        if (!updatedTask) {
          throw new HTTPException(500, {
            message: "Failed to update task phase",
          });
        }

        return updatedTask;
      },
    );

    await this.effects.publishTaskMutation(before, after, currentUserId, {
      fields: ["phaseId", "sprintId"],
    });

    return after;
  }

  async updateTaskSprint({
    id,
    sprintId,
    currentUserId,
  }: Write & { sprintId: string | null }) {
    const { before, after } = await withLockedTask(
      this.dataSource,
      id,
      async (tx, existingTask): Promise<TaskRow> => {
        const nextSprintId = sprintId?.trim() || null;
        if (existingTask.sprintId === nextSprintId && !nextSprintId) {
          return existingTask;
        }

        const flags = await getProjectPlanningFlags(tx, existingTask.projectId);
        if (!flags.sprintsEnabled) {
          throw new HTTPException(403, {
            message: "Sprints are not enabled for this project",
          });
        }

        // A sprint inside a phase moves the task into that phase.
        let nextPhaseId = existingTask.phaseId;
        if (nextSprintId) {
          await assertSprintInProject(tx, nextSprintId, existingTask.projectId);
          const sprintPhaseId = await findSprintPhaseId(tx, nextSprintId);
          if (flags.phasesEnabled && sprintPhaseId) {
            nextPhaseId = sprintPhaseId;
          }
        }

        if (
          existingTask.sprintId === nextSprintId &&
          existingTask.phaseId === nextPhaseId
        ) {
          return existingTask;
        }

        const updatedTask = await updateTask(tx, id, {
          sprintId: nextSprintId,
          phaseId: nextPhaseId,
        });

        if (!updatedTask) {
          throw new HTTPException(500, {
            message: "Failed to update task sprint",
          });
        }

        return updatedTask;
      },
    );

    await this.effects.publishTaskMutation(before, after, currentUserId, {
      fields: ["sprintId", "phaseId"],
    });

    return after;
  }
}
