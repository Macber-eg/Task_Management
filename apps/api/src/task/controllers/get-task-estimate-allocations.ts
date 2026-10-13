import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  taskEstimateAllocationTable,
  taskTable,
  userTable,
} from "../../database/schema";

async function getTaskEstimateAllocations(taskId: string) {
  const [task] = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);

  if (!task) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  return db
    .select({
      id: taskEstimateAllocationTable.id,
      taskId: taskEstimateAllocationTable.taskId,
      userId: taskEstimateAllocationTable.userId,
      userName: userTable.name,
      estimatedMinutes: taskEstimateAllocationTable.estimatedMinutes,
    })
    .from(taskEstimateAllocationTable)
    .leftJoin(userTable, eq(taskEstimateAllocationTable.userId, userTable.id))
    .where(eq(taskEstimateAllocationTable.taskId, taskId));
}

export default getTaskEstimateAllocations;
