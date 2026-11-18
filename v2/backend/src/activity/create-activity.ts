import type { EntityManager } from "typeorm";
import { insertReturning } from "../database/dml";
import { ActivityEntity } from "../database/entities/activity.entity";

/** Records one event on a task's activity feed and returns the stored row. */
export async function createActivity(
  manager: EntityManager,
  taskId: string,
  type: string,
  userId: string,
  content: string | null,
  eventData?: Record<string, unknown> | null,
): Promise<ActivityEntity | undefined> {
  return insertReturning(manager, ActivityEntity, {
    taskId,
    type,
    userId,
    content,
    eventData: eventData ?? null,
  });
}
