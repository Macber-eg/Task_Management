import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { updateReturning } from "../database/dml";
import { TimeEntryEntity } from "../database/entities/time-entry.entity";
import { resolveDuration } from "./duration";
import { recordTimeEntryAudit } from "./time-entry-audit";

type UpdateTimeEntryParams = {
  timeEntryId: string;
  startTime: Date;
  endTime?: Date;
  description?: string;
  actorUserId?: string;
};

@Injectable()
export class TimeEntryUpdateService {
  constructor(private readonly dataSource: DataSource) {}

  /** An omitted endTime keeps the stored one, and the duration follows it. */
  async updateTimeEntry(params: UpdateTimeEntryParams) {
    const { timeEntryId, startTime, endTime, description } = params;
    const manager = this.dataSource.manager;

    const existingTimeEntry = await manager.findOne(TimeEntryEntity, {
      where: { id: timeEntryId },
    });

    if (!existingTimeEntry) {
      throw new HTTPException(404, {
        message: "Time entry not found",
      });
    }

    const effectiveEndTime = endTime ?? existingTimeEntry.endTime;

    const duration = resolveDuration(startTime, effectiveEndTime ?? undefined);

    const [updatedTimeEntry] = await updateReturning(
      manager,
      TimeEntryEntity,
      {
        startTime,
        endTime: effectiveEndTime,
        duration,
        ...(description !== undefined && { description }),
      },
      { id: timeEntryId },
    );

    if (params.actorUserId) {
      await recordTimeEntryAudit(manager, {
        timeEntryId,
        taskId: existingTimeEntry.taskId,
        actorUserId: params.actorUserId,
        action: "update",
        beforeData: existingTimeEntry,
        afterData: updatedTimeEntry,
      });
    }

    return updatedTimeEntry;
  }
}
