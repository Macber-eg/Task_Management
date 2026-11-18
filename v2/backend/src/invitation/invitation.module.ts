import { Module } from "@nestjs/common";
import { InvitationController } from "./invitation.controller";
import { InvitationQueryService } from "./invitation-query.service";

@Module({
  controllers: [InvitationController],
  providers: [InvitationQueryService],
})
export class InvitationModule {}
