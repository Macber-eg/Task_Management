import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { EventBus } from "../../../events/event-bus";
import { TaskMutationEffects } from "../../effects/task-mutation-effects.service";
import {
  assertValidTaskStatus,
  findStatusColumnId,
} from "../../shared/task-status";
import { updateTask } from "../../shared/task-writes";
import { withLockedTask } from "../../shared/with-locked-task";

@Injectable()
export class TaskStatusService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly effects: TaskMutationEffects,
  ) {}

  async updateTaskStatus({
    id,
    status,
    currentUserId,
  }: {
    id: string;
    status: string;
    currentUserId: string;
  }) {
    const { before: existingTask, after: updatedTask } = await withLockedTask(
      this.dataSource,
      id,
      async (tx, existingTask) => {
        await assertValidTaskStatus(tx, status, existingTask.projectId);
        const columnId = await findStatusColumnId(
          tx,
          existingTask.projectId,
          status,
        );

        const updatedTask = await updateTask(tx, id, { status, columnId });

        if (!updatedTask) {
          throw new HTTPException(500, {
            message: "Failed to update task status",
          });
        }

        return updatedTask;
      },
    );

    await this.effects.publishTaskMutation(
      existingTask,
      updatedTask,
      currentUserId,
      { fields: ["status"] },
    );

    if (
      existingTask.status === updatedTask.status &&
      existingTask.columnId !== updatedTask.columnId
    )
      await this.events.publish("task.updated", {
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        userId: currentUserId,
      });

    return updatedTask;
  }
}
