import { Module } from "@nestjs/common";
import { RelationAccessHandler } from "./relation-access.handler";
import { SourceTaskAccessHandler } from "./source-task-access.handler";
import { TaskRelationController } from "./task-relation.controller";
import { TaskRelationCreationService } from "./task-relation-creation.service";
import { TaskRelationDeletionService } from "./task-relation-deletion.service";
import { TaskRelationQueryService } from "./task-relation-query.service";

@Module({
  controllers: [TaskRelationController],
  providers: [
    SourceTaskAccessHandler,
    RelationAccessHandler,
    TaskRelationQueryService,
    TaskRelationCreationService,
    TaskRelationDeletionService,
  ],
})
export class TaskRelationModule {}
