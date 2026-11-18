import { Module } from "@nestjs/common";
import { ActiveImports } from "./active-imports";
import { ImportController } from "./import.controller";
import { ImportRunQueryService } from "./import-run-query.service";
import { ImportRunStartService } from "./import-run-start.service";
import { ImportShutdown } from "./import-shutdown";
import { ImportSourceProjectsService } from "./import-source-projects.service";
import { ImportedProjectWriter } from "./imported-project-writer.service";

@Module({
  controllers: [ImportController],
  providers: [
    ActiveImports,
    ImportShutdown,
    ImportedProjectWriter,
    ImportSourceProjectsService,
    ImportRunStartService,
    ImportRunQueryService,
  ],
})
export class ImportModule {}
