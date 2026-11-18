import { Injectable } from "@nestjs/common";
import { DataSource, IsNull } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { TaskEntity } from "../database/entities/task.entity";
import { TimeEntryEntity } from "../database/entities/time-entry.entity";
import { EventBus } from "../events/event-bus";
import { resolveDuration } from "./duration";

@Injectable()
export class TimeEntryCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  /** Logs time; without an end time it starts the user's one running timer. */
  async createTimeEntry({
    taskId,
    userId,
    description,
    startTime,
    endTime,
  }: {
    taskId: string;
    userId: string;
    description?: string;
    startTime: Date;
    endTime?: Date;
  }): Promise<TimeEntryEntity> {
    const manager = this.dataSource.manager;
    const duration = resolveDuration(startTime, endTime);

    if (!endTime) {
      const running = await manager.findOne(TimeEntryEntity, {
        where: { userId, endTime: IsNull() },
        select: { id: true },
      });
      if (running) {
        throw new HTTPException(409, {
          message: "Stop your current timer before starting another",
        });
      }
    }

    const createdTimeEntry = await insertReturning(manager, TimeEntryEntity, {
      taskId,
      userId,
      description: description || "",
      startTime,
      endTime: endTime || null,
      duration,
    });

    if (!createdTimeEntry) {
      throw new HTTPException(500, {
        message: "Failed to create time entry",
      });
    }

    const task = await manager.findOne(TaskEntity, {
      where: { id: taskId },
      select: { id: true, userId: true, title: true },
    });

    await this.events.publish("time-entry.created", {
      timeEntryId: createdTimeEntry.id,
      taskId: createdTimeEntry.taskId,
      userId,
      type: "create",
      content: "started time tracking",
      taskOwnerId: task?.userId,
      taskTitle: task?.title,
    });

    return createdTimeEntry;
  }
}
