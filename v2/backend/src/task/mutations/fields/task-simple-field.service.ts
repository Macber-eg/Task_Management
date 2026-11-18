import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { TaskMutationEffects } from "../../effects/task-mutation-effects.service";
import { updateTask } from "../../shared/task-writes";
import { withLockedTask } from "../../shared/with-locked-task";

type Write = { id: string; currentUserId: string };

/**
 * Single-field writes with no rules beyond the value itself: priority,
 * description and estimate. Each locks the task, writes, then publishes only
 * its own field so a concurrent edit is not attributed to this caller.
 */
@Injectable()
export class TaskSimpleFieldService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly effects: TaskMutationEffects,
  ) {}

  async updateTaskPriority({
    id,
    priority,
    currentUserId,
  }: Write & { priority: string }) {
    const { before, after } = await this.write(
      id,
      { priority },
      "Failed to update task priority",
    );
    await this.effects.publishTaskMutation(before, after, currentUserId, {
      fields: ["priority"],
    });
    return after;
  }

  async updateTaskDescription({
    id,
    description,
    currentUserId,
  }: Write & { description: string }) {
    const { before, after } = await this.write(
      id,
      { description },
      "Failed to update task description",
    );
    await this.effects.publishTaskMutation(before, after, currentUserId, {
      fields: ["description"],
    });
    return after;
  }

  async updateTaskEstimate({
    id,
    estimatedMinutes,
    currentUserId,
  }: Write & { estimatedMinutes: number | null }) {
    if (estimatedMinutes != null && estimatedMinutes < 0) {
      throw new HTTPException(400, { message: "Estimate cannot be negative" });
    }
    const { before, after } = await this.write(
      id,
      { estimatedMinutes },
      "Failed to update estimate",
    );
    await this.effects.publishTaskMutation(before, after, currentUserId);
    return after;
  }

  private async write(
    id: string,
    set: Parameters<typeof updateTask>[2],
    failure: string,
  ) {
    return withLockedTask(this.dataSource, id, async (tx) => {
      const updatedTask = await updateTask(tx, id, set);
      if (!updatedTask) {
        throw new HTTPException(500, { message: failure });
      }
      return updatedTask;
    });
  }
}
