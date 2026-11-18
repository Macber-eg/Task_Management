import { Module } from "@nestjs/common";
import { LabelController } from "./label.controller";
import { LabelAssignmentService } from "./label-assignment.service";
import { LabelCreationService } from "./label-creation.service";
import { LabelDeletionLock } from "./label-deletion-lock";
import { LabelDeletionService } from "./label-deletion.service";
import { LabelIntegrationSync } from "./label-integration-sync";
import { LabelQueryService } from "./label-query.service";
import { LabelUpdateService } from "./label-update.service";
import { NoopLabelIntegrationSync } from "./noop-label-integration-sync";

@Module({
  controllers: [LabelController],
  providers: [
    LabelQueryService,
    LabelCreationService,
    LabelAssignmentService,
    LabelUpdateService,
    LabelDeletionLock,
    LabelDeletionService,
    { provide: LabelIntegrationSync, useClass: NoopLabelIntegrationSync },
  ],
})
export class LabelModule {}
