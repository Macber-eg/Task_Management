import { Module } from "@nestjs/common";
import { ExternalLinkController } from "./external-link.controller";
import { ExternalLinkCreationService } from "./external-link-creation.service";
import { ExternalLinkDeletionService } from "./external-link-deletion.service";
import { ExternalLinkQueryService } from "./external-link-query.service";

@Module({
  controllers: [ExternalLinkController],
  providers: [
    ExternalLinkQueryService,
    ExternalLinkCreationService,
    ExternalLinkDeletionService,
  ],
})
export class ExternalLinkModule {}
