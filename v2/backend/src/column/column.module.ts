import { Module } from "@nestjs/common";
import { ColumnController } from "./column.controller";
import { ColumnCreationService } from "./column-creation.service";
import { ColumnDeletionService } from "./column-deletion.service";
import { ColumnQueryService } from "./column-query.service";
import { ColumnReorderService } from "./column-reorder.service";
import { ColumnUpdateService } from "./column-update.service";

@Module({
  controllers: [ColumnController],
  providers: [
    ColumnQueryService,
    ColumnCreationService,
    ColumnReorderService,
    ColumnUpdateService,
    ColumnDeletionService,
  ],
})
export class ColumnModule {}
