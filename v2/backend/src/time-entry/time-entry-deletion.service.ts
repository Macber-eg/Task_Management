import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { TimeEntryEntity } from "../database/entities/time-entry.entity";
import { recordTimeEntryAudit } from "./time-entry-audit";

@Injectable()
export class TimeEntryDeletionService {
  constructor(private readonly dataSource: DataSource) {}

  /** Audits the entry, then deletes it; answers with the deleted entry. */
  async deleteTimeEntry(timeEntryId: string, actorUserId: string) {
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(TimeEntryEntity, {
      where: { id: timeEntryId },
    });

    if (!existing) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    await recordTimeEntryAudit(manager, {
      timeEntryId,
      taskId: existing.taskId,
      actorUserId,
      action: "delete",
      beforeData: existing,
    });

    await manager.delete(TimeEntryEntity, { id: timeEntryId });

    return existing;
  }
}
