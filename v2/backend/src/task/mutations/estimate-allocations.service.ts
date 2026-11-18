import { Injectable } from "@nestjs/common";
import { createId } from "@paralleldrive/cuid2";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { TaskEstimateAllocationEntity } from "../../database/entities/task-estimate-allocation.entity";

type AllocationInput = { userId: string; estimatedMinutes: number };

/** How a task's estimate is split between members. */
@Injectable()
export class EstimateAllocationsService {
  constructor(private readonly dataSource: DataSource) {}

  async getTaskEstimateAllocations(taskId: string) {
    await this.findTask(taskId);

    return (await this.dataSource.query(
      `SELECT a.id, a.task_id AS "taskId", a.user_id AS "userId",
         u.name AS "userName", a.estimated_minutes AS "estimatedMinutes"
       FROM task_estimate_allocation a
       LEFT JOIN "user" u ON a.user_id = u.id
       WHERE a.task_id = $1`,
      [taskId],
    )) as unknown[];
  }

  async putTaskEstimateAllocations(
    taskId: string,
    allocations: AllocationInput[],
  ) {
    const task = await this.findTask(taskId);

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

    await this.dataSource.transaction(async (tx) => {
      await tx.delete(TaskEstimateAllocationEntity, { taskId });

      if (normalized.length === 0) return;

      await tx
        .createQueryBuilder()
        .insert()
        .into(TaskEstimateAllocationEntity)
        .values(
          normalized.map((row) => ({
            id: createId(),
            taskId,
            userId: row.userId,
            estimatedMinutes: row.estimatedMinutes,
          })),
        )
        .updateEntity(false)
        .execute();
    });

    return this.dataSource.manager.find(TaskEstimateAllocationEntity, {
      where: { taskId },
    });
  }

  private async findTask(taskId: string) {
    const [task] = (await this.dataSource.query(
      `SELECT id, estimated_minutes AS "estimatedMinutes" FROM task
       WHERE id = $1 LIMIT 1`,
      [taskId],
    )) as { id: string; estimatedMinutes: number | null }[];

    if (!task) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    return task;
  }
}
