import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { projectSprintTable, taskTable } from "../../database/schema";
import {
  assertPhaseInProject,
  getProjectPlanningFlags,
} from "../../planning/assert-planning";
import { withLockedTask } from "./with-locked-task";
import { publishTaskMutation } from "./task-mutation-effects";

async function updateTaskPhase({
  id,
  phaseId,
  currentUserId,
}: {
  id: string;
  phaseId: string | null;
  currentUserId: string;
}) {
  const { before: existingTask, after: updatedTask } = await withLockedTask(
    id,
    async (tx, existingTask) => {
      const nextPhaseId = phaseId?.trim() || null;

      const flags = await getProjectPlanningFlags(existingTask.projectId, tx);
      if (!flags.phasesEnabled) {
        throw new HTTPException(403, {
          message: "Phases are not enabled for this project",
        });
      }

      if (nextPhaseId) {
        await assertPhaseInProject(nextPhaseId, existingTask.projectId, tx);
      }

      let nextSprintId = existingTask.sprintId;
      if (existingTask.sprintId) {
        const [sprint] = await tx
          .select({ phaseId: projectSprintTable.phaseId })
          .from(projectSprintTable)
          .where(eq(projectSprintTable.id, existingTask.sprintId))
          .limit(1);
        if (sprint?.phaseId && sprint.phaseId !== nextPhaseId) {
          nextSprintId = null;
        }
      }

      if (
        existingTask.phaseId === nextPhaseId &&
        existingTask.sprintId === nextSprintId
      ) {
        return existingTask;
      }

      const [updatedTask] = await tx
        .update(taskTable)
        .set({ phaseId: nextPhaseId, sprintId: nextSprintId })
        .where(eq(taskTable.id, id))
        .returning();

      if (!updatedTask) {
        throw new HTTPException(500, {
          message: "Failed to update task phase",
        });
      }

      return updatedTask;
    },
  );

  await publishTaskMutation(existingTask, updatedTask, currentUserId, {
    fields: ["phaseId", "sprintId"],
  });

  return updatedTask;
}

export default updateTaskPhase;
