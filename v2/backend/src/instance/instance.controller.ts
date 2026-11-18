import { Controller } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { ApiRoute } from "../common/openapi";
import { getInstanceStatusRoute } from "./instance.routes";
import { InstanceStatusService } from "./instance-status.service";

@Controller("instance")
export class InstanceController {
  constructor(private readonly status: InstanceStatusService) {}

  @Public()
  @ApiRoute(getInstanceStatusRoute)
  getInstanceStatus() {
    return this.status.getInstanceStatus();
  }
}
