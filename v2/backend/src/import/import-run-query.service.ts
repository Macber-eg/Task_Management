import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { ImportRunEntity } from "../database/entities/import-run.entity";
import { markStaleRuns } from "./runs/mark-stale-runs";
import { toImportRunResponse } from "./runs/to-import-run-response";

const LISTED_RUNS = 20;

@Injectable()
export class ImportRunQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async listImportRuns(workspaceId: string) {
    const rows = await this.dataSource.manager.find(ImportRunEntity, {
      where: { workspaceId },
      order: { createdAt: "DESC", id: "DESC" },
      take: LISTED_RUNS,
    });

    const now = new Date();
    await markStaleRuns(this.dataSource.manager, rows, now);

    return { runs: rows.map((row) => toImportRunResponse(row, now)) };
  }

  async getImportRun(workspaceId: string, runId: string) {
    const row = await this.dataSource.manager.findOne(ImportRunEntity, {
      where: { id: runId, workspaceId },
    });

    if (!row) {
      throw new HTTPException(404, { message: "Import not found" });
    }

    const now = new Date();
    await markStaleRuns(this.dataSource.manager, [row], now);

    return { run: toImportRunResponse(row, now) };
  }
}
