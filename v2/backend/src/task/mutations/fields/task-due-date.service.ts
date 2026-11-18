import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { TaskMutationEffects } from "../../effects/task-mutation-effects.service";
import { findTaskRow } from "../../shared/task-row";
import { updateTask } from "../../shared/task-writes";

@Injectable()
export class TaskDueDateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly effects: TaskMutationEffects,
  ) {}

  async updateTaskDueDate({
    id,
    dueDate,
    currentUserId,
  }: {
    id: string;
    dueDate: Date | null;
    currentUserId: string;
  }) {
    let existingTask = await findTaskRow(this.dataSource.manager, id);

    if (!existingTask) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    const updatedTask = await this.dataSource.transaction(async (tx) => {
      const locked = await findTaskRow(tx, id, { lock: true });
      if (!locked) throw new HTTPException(404, { message: "Task not found" });
      existingTask = locked;

      const task = await updateTask(tx, id, { dueDate: dueDate || null });
      if (task)
        await this.effects.recordTaskMutation(
          tx,
          locked,
          { dueDate },
          currentUserId,
        );
      return task;
    });

    if (!updatedTask) {
      throw new HTTPException(500, {
        message: "Failed to update task due date",
      });
    }

    await this.effects.publishTaskMutation(
      existingTask,
      updatedTask,
      currentUserId,
      { fields: ["dueDate"] },
    );

    return updatedTask;
  }
}
