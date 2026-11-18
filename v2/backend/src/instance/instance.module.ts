import { Module } from "@nestjs/common";
import { InstanceController } from "./instance.controller";
import { InstanceStatusService } from "./instance-status.service";

@Module({
  controllers: [InstanceController],
  providers: [InstanceStatusService],
})
export class InstanceModule {}
