import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskEstimateAllocationTable, taskTable } from "../../database/schema";

type AllocationInput = { userId: string; estimatedMinutes: number };

async function putTaskEstimateAllocations(
  taskId: string,
  allocations: AllocationInput[],
) {
  const [task] = await db
    .select({
      id: taskTable.id,
      estimatedMinutes: taskTable.estimatedMinutes,
    })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);

  if (!task) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  const normalized = allocations
    .map((row) => ({
      userId: row.userId,
      estimatedMinutes: Math.max(0, Math.floor(row.estimatedMinutes) || 0),
    }))
    .filter((row) => row.estimatedMinutes > 0);

  const totalAllocated = normalized.reduce(
    (sum, row) => sum + row.estimatedMinutes,
    0,
  );
  const taskEstimate = task.estimatedMinutes ?? 0;
  if (taskEstimate > 0 && totalAllocated > taskEstimate) {
    throw new HTTPException(400, {
      message: "Allocated estimate exceeds the task estimate",
    });
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(taskEstimateAllocationTable)
      .where(eq(taskEstimateAllocationTable.taskId, taskId));

    if (normalized.length === 0) return;

    await tx.insert(taskEstimateAllocationTable).values(
      normalized.map((row) => ({
        id: createId(),
        taskId,
        userId: row.userId,
        estimatedMinutes: row.estimatedMinutes,
      })),
    );
  });

  return db
    .select()
    .from(taskEstimateAllocationTable)
    .where(eq(taskEstimateAllocationTable.taskId, taskId));
}

export default putTaskEstimateAllocations;
