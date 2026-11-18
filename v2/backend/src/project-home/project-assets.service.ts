import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { AssetEntity } from "../database/entities/asset.entity";

/** A project's most recent uploads, metadata only. */
@Injectable()
export class ProjectAssetsService {
  constructor(private readonly dataSource: DataSource) {}

  listProjectAssets(projectId: string, limit = 20) {
    return this.dataSource.manager.find(AssetEntity, {
      where: { projectId },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        kind: true,
        taskId: true,
        createdAt: true,
      },
      order: { createdAt: "DESC" },
      take: limit,
    });
  }
}
