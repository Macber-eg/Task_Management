import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ColumnEntity } from "../database/entities/column.entity";

@Injectable()
export class ColumnQueryService {
  constructor(private readonly dataSource: DataSource) {}

  getColumns(projectId: string): Promise<ColumnEntity[]> {
    return this.dataSource.manager.find(ColumnEntity, {
      where: { projectId },
      order: { position: "ASC" },
    });
  }
}
