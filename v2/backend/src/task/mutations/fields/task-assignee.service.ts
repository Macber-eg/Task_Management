import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { TaskMutationEffects } from "../../effects/task-mutation-effects.service";
import {
  assertAssignableUser,
  getProjectWorkspaceId,
} from "../../shared/assignable-users";
import type { TaskRow } from "../../shared/task-row";
import { updateTask } from "../../shared/task-writes";
import { withLockedTask } from "../../shared/with-locked-task";

@Injectable()
export class TaskAssigneeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly effects: TaskMutationEffects,
  ) {}

  async updateTaskAssignee({
    id,
    userId,
    currentUserId,
  }: {
    id: string;
    userId: string | null;
    currentUserId: string;
  }) {
    const { before: existingTask, after: updatedTask } = await withLockedTask(
      this.dataSource,
      id,
      async (tx, existingTask): Promise<TaskRow> => {
        const nextAssigneeId = userId?.trim() || null;
        if (existingTask.userId === nextAssigneeId) {
          return existingTask;
        }

        if (nextAssigneeId) {
          await assertAssignableUser(
            tx,
            nextAssigneeId,
            await getProjectWorkspaceId(tx, existingTask.projectId),
            existingTask.projectId,
          );
        }

        const updatedTask = await updateTask(tx, id, {
          userId: nextAssigneeId,
        });

        if (!updatedTask) {
          throw new HTTPException(500, {
            message: "Failed to update task assignee",
          });
        }

        return updatedTask;
      },
    );

    await this.effects.publishTaskMutation(
      existingTask,
      updatedTask,
      currentUserId,
      { fields: ["userId"] },
    );

    return updatedTask;
  }
}
