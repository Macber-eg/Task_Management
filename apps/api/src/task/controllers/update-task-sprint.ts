import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { projectSprintTable, taskTable } from "../../database/schema";
import {
  assertSprintInProject,
  getProjectPlanningFlags,
} from "../../planning/assert-planning";
import { withLockedTask } from "./with-locked-task";
import { publishTaskMutation } from "./task-mutation-effects";

async function updateTaskSprint({
  id,
  sprintId,
  currentUserId,
}: {
  id: string;
  sprintId: string | null;
  currentUserId: string;
}) {
  const { before: existingTask, after: updatedTask } = await withLockedTask(
    id,
    async (tx, existingTask) => {
      const nextSprintId = sprintId?.trim() || null;
      if (existingTask.sprintId === nextSprintId && !nextSprintId) {
        return existingTask;
      }

      const flags = await getProjectPlanningFlags(existingTask.projectId, tx);
      if (!flags.sprintsEnabled) {
        throw new HTTPException(403, {
          message: "Sprints are not enabled for this project",
        });
      }

      let nextPhaseId = existingTask.phaseId;
      if (nextSprintId) {
        await assertSprintInProject(nextSprintId, existingTask.projectId, tx);
        const [sprint] = await tx
          .select({ phaseId: projectSprintTable.phaseId })
          .from(projectSprintTable)
          .where(eq(projectSprintTable.id, nextSprintId))
          .limit(1);
        if (flags.phasesEnabled && sprint?.phaseId) {
          nextPhaseId = sprint.phaseId;
        }
      }

      if (
        existingTask.sprintId === nextSprintId &&
        existingTask.phaseId === nextPhaseId
      ) {
        return existingTask;
      }

      const [updatedTask] = await tx
        .update(taskTable)
        .set({ sprintId: nextSprintId, phaseId: nextPhaseId })
        .where(eq(taskTable.id, id))
        .returning();

      if (!updatedTask) {
        throw new HTTPException(500, {
          message: "Failed to update task sprint",
        });
      }

      return updatedTask;
    },
  );

  await publishTaskMutation(existingTask, updatedTask, currentUserId, {
    fields: ["sprintId", "phaseId"],
  });

  return updatedTask;
}

export default updateTaskSprint;
