import { Module } from "@nestjs/common";
import { DeviceApprovalService } from "./device-approval.service";
import { DeviceCodeService } from "./device-code.service";
import { DeviceSessionService } from "./device-session.service";
import { DeviceTokenService } from "./device-token.service";
import { DeviceController } from "./device.controller";

/** CLI and MCP login through device authorization. */
@Module({
  controllers: [DeviceController],
  providers: [
    DeviceCodeService,
    DeviceTokenService,
    DeviceApprovalService,
    DeviceSessionService,
  ],
})
export class DeviceAuthModule {}
