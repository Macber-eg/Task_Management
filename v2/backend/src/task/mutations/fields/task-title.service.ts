import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { TaskMutationEffects } from "../../effects/task-mutation-effects.service";
import { findTaskRow } from "../../shared/task-row";
import { updateTask } from "../../shared/task-writes";

@Injectable()
export class TaskTitleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly effects: TaskMutationEffects,
  ) {}

  async updateTaskTitle({
    id,
    title,
    currentUserId,
  }: {
    id: string;
    title: string;
    currentUserId: string;
  }) {
    let existingTask = await findTaskRow(this.dataSource.manager, id);

    if (!existingTask) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    if (existingTask.title === title) return existingTask;

    // Audit history is not best-effort. Commit the title and its immutable
    // history row atomically; event subscribers remain notifications and
    // integrations only and cannot make the audit trail disappear.
    const updatedTask = await this.dataSource.transaction(async (tx) => {
      const locked = await findTaskRow(tx, id, { lock: true });
      if (!locked) throw new HTTPException(404, { message: "Task not found" });
      existingTask = locked;

      const task = await updateTask(tx, id, { title });

      if (!task) {
        throw new HTTPException(500, {
          message: "Failed to update task title",
        });
      }

      await this.effects.recordTaskMutation(
        tx,
        locked,
        { title },
        currentUserId,
      );

      return task;
    });

    await this.effects.publishTaskMutation(
      existingTask,
      updatedTask,
      currentUserId,
      { fields: ["title"] },
    );

    return updatedTask;
  }
}
