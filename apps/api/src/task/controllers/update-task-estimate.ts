import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { taskTable } from "../../database/schema";
import { publishTaskMutation } from "./task-mutation-effects";
import { withLockedTask } from "./with-locked-task";

async function updateTaskEstimate({
  id,
  estimatedMinutes,
  currentUserId,
}: {
  id: string;
  estimatedMinutes: number | null;
  currentUserId: string;
}) {
  if (estimatedMinutes != null && estimatedMinutes < 0) {
    throw new HTTPException(400, { message: "Estimate cannot be negative" });
  }

  const { before: existingTask, after: updatedTask } = await withLockedTask(
    id,
    async (tx) => {
      const [updatedTask] = await tx
        .update(taskTable)
        .set({ estimatedMinutes })
        .where(eq(taskTable.id, id))
        .returning();

      if (!updatedTask) {
        throw new HTTPException(500, { message: "Failed to update estimate" });
      }

      return updatedTask;
    },
  );

  await publishTaskMutation(existingTask, updatedTask, currentUserId);

  return updatedTask;
}

export default updateTaskEstimate;
